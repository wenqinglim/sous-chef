/**
 * Instagram reel recipe extraction.
 *
 * Recipe websites expose schema.org JSON-LD; Instagram does not. Instead we
 * assume the reel's *caption* contains the full recipe (ingredients + steps),
 * gate it through a cheap heuristic to reject non-recipe captions, and hand the
 * surviving text to the existing LLM extractor. When the caption is absent or
 * incomplete, we fall back to transcribing the reel's audio.
 *
 * Instagram login-walls server requests from datacenter IPs, so the caption and
 * video are sourced via a third-party scraper provider (see
 * `instagram-scraper.ts`) rather than fetched directly. Reels the scraper can't
 * read (private/removed) surface as an error — and the UI offers a manual
 * caption-paste path — rather than a bad recipe.
 */

import * as cheerio from "cheerio";
import { extractWithLlm, type LlmExtractionResult } from "@/lib/extractors/llm-fallback";
import {
  binaryFetch,
  transcribeWithWhisper,
  MAX_VIDEO_BYTES,
} from "@/lib/extractors/instagram-audio";
import { fetchInstagramMedia } from "@/lib/extractors/instagram-scraper";
import { UNIT_RE_SOURCE } from "@/lib/units/parser";

const INSTAGRAM_HOSTS = new Set([
  "instagram.com",
  "www.instagram.com",
  "m.instagram.com",
  "instagr.am",
  "www.instagr.am",
]);

/** Extract the reel/post shortcode from an Instagram URL (`/reel/X/`, `/reels/X/`, `/p/X/`). */
export function instagramShortcode(url: string): string | null {
  try {
    return (
      new URL(url).pathname.match(/\/(?:reels?|p|tv)\/([^/?#]+)/)?.[1] ?? null
    );
  } catch {
    return null;
  }
}

/** True when `url` points at Instagram, so the route uses the caption path. */
export function isInstagramUrl(url: string): boolean {
  try {
    return INSTAGRAM_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

// ─── Caption extraction ─────────────────────────────────────────────────────

/**
 * Instagram's og:description / meta description wraps the caption in an
 * attribution preamble. Strip that prefix and any surrounding quotes.
 *
 * Formats seen in the wild (the comment count, and sometimes the counts
 * entirely, can be absent):
 *   "1,234 likes, 56 comments - user on January 1, 2024: "<caption>""
 *   "1,234 likes - user on January 1, 2024: "<caption>""
 *   "user on Instagram: "<caption>""
 */
function stripCaptionPreamble(raw: string): string {
  let s = raw.trim();
  // Engagement-count lead-in: anchored on a literal "likes" so a real caption
  // ("Garlic Noodles: …") is never touched. The lazy run swallows an optional
  // ", N comments - user on <date>" tail up to the first colon.
  s = s.replace(/^[\d,.\sKMB]*likes?\b[^:\n]*?:\s*/i, "");
  // Bare "<user> on Instagram:" attribution with no engagement counts.
  s = s.replace(/^[^:\n]*?\bon Instagram\b\s*:\s*/i, "");
  // Unwrap a single layer of surrounding quotes (straight or curly).
  s = s.replace(/^["“”']+/, "").replace(/["“”']+$/, "");
  return s.trim();
}

/**
 * Walk a parsed JSON-LD value for the post caption. Prefers an explicit
 * `caption` field, then `articleBody`, then `description` — only falling back to
 * `description` last avoids picking up boilerplate ("See photos and videos
 * from …") that may be longer than the real caption. Length breaks ties within
 * a single field.
 */
function findCaptionInJsonLd(value: unknown): string | null {
  const longest: Record<"caption" | "articleBody" | "description", string | null> = {
    caption: null,
    articleBody: null,
    description: null,
  };
  const consider = (field: keyof typeof longest, s: unknown) => {
    if (typeof s === "string") {
      const cur = longest[field];
      if (cur === null || s.length > cur.length) longest[field] = s;
    }
  };
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      consider("caption", obj.caption);
      consider("articleBody", obj.articleBody);
      consider("description", obj.description);
      Object.values(obj).forEach(walk);
    }
  };
  walk(value);
  return longest.caption ?? longest.articleBody ?? longest.description;
}

/**
 * Pull the reel caption out of a fetched Instagram page.
 *
 * Prefers a substantial JSON-LD caption, then falls back to the og:description
 * / meta description (with its engagement preamble stripped). Returns null when
 * nothing usable is recoverable (login wall, empty page).
 */
export function extractInstagramCaption(html: string): string | null {
  const $ = cheerio.load(html);

  // 1. JSON-LD — may carry the full, untruncated caption.
  let jsonLdBest: string | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    const content = $(el).html();
    if (!content) return;
    try {
      const found = findCaptionInJsonLd(JSON.parse(content));
      if (found && (jsonLdBest === null || found.length > jsonLdBest.length)) {
        jsonLdBest = found;
      }
    } catch {
      // ignore malformed JSON-LD blocks
    }
  });
  if (jsonLdBest) {
    const cleaned = stripCaptionPreamble(jsonLdBest);
    if (cleaned) return cleaned;
  }

  // 2. og:description / meta description fallback.
  const meta =
    $('meta[property="og:description"]').attr("content") ??
    $('meta[name="description"]').attr("content") ??
    null;
  if (meta) {
    const cleaned = stripCaptionPreamble(meta);
    if (cleaned) return cleaned;
  }

  return null;
}

// ─── Recipe heuristic ────────────────────────────────────────────────────────

const MIN_CAPTION_LENGTH = 40;

const RECIPE_KEYWORD_RE =
  /\b(ingredients?|recipe|method|directions?|instructions?|serves?|servings?|prep(?:\s|aration)|cook(?:ing)?\s*time|preheat|combine|stir|whisk|bake)\b/i;

// "2 cups", "½ tsp", "200g", "1 tbsp" — a number (digit or unicode fraction)
// directly followed by a known unit token. Reuses the parser's exact unit
// alternation (UNIT_RE_SOURCE) so the heuristic stays in step with what we can
// actually parse, with no second copy to drift.
const QUANTITY_UNIT_RE = new RegExp(
  `[\\d\\u00BC-\\u00BE\\u2150-\\u215E]\\s*(?:${UNIT_RE_SOURCE})\\b`,
  "gi"
);

/**
 * Cheap pre-LLM gate: does this caption plausibly contain a recipe?
 *
 * True when the caption is long enough AND either mentions a recipe keyword or
 * lists several quantity+unit measurements. Keeps non-recipe reels (promos,
 * vibe captions) from reaching the LLM and being saved as junk recipes.
 */
export function looksLikeRecipe(caption: string): boolean {
  const text = caption.trim();
  if (text.length < MIN_CAPTION_LENGTH) return false;

  if (RECIPE_KEYWORD_RE.test(text)) return true;

  const quantityMatches = text.match(QUANTITY_UNIT_RE);
  return quantityMatches !== null && quantityMatches.length >= 3;
}

// ─── Orchestration ───────────────────────────────────────────────────────────

/**
 * Extract a recipe from a fetched Instagram reel page.
 *
 * caption parse → recipe heuristic → LLM extraction. Returns the same shape as
 * the website LLM fallback so the route handles both identically.
 */
export async function extractFromInstagram(
  html: string,
  url: string
): Promise<LlmExtractionResult> {
  const caption = extractInstagramCaption(html);
  if (!caption) {
    // Couldn't get usable content out of the page (login wall / private /
    // removed) — that's an upstream-fetch problem, not "this isn't a recipe".
    return {
      recipe: null,
      error:
        "Couldn't read this Instagram reel's caption. It may be private, removed, or require login.",
      kind: "extractor_error",
    };
  }

  if (!looksLikeRecipe(caption)) {
    return {
      recipe: null,
      error:
        "This Instagram caption doesn't look like a recipe. Make sure the reel's caption includes the ingredients and steps.",
      kind: "no_recipe",
    };
  }

  return extractWithLlm(caption, url);
}

/**
 * Extract a recipe from an Instagram reel, with audio fallback.
 *
 * Fetches the reel's caption + video URL via the scraper provider
 * (`fetchInstagramMedia`). Tries the caption first; if it's absent, not a
 * recipe, or yields an incomplete recipe (missing ingredients OR instructions),
 * downloads the reel video, transcribes it with Groq Whisper, and runs the
 * transcript through the LLM extractor.
 *
 * When audio fallback fails but the caption yielded a partial recipe, the
 * partial result is returned rather than an error — partial is better than
 * losing what the caption did contain.
 *
 * @param url       The reel URL.
 * @param onStatus  Called with human-readable progress strings for UI display.
 */
export async function extractFromInstagramWithAudio(
  url: string,
  onStatus: (msg: string) => void
): Promise<LlmExtractionResult> {
  // ── Fetch caption + video via the scraper (off our IP) ─────────────────────
  onStatus("Fetching reel…");
  const media = await fetchInstagramMedia(url);

  if (!media) {
    // Provider unconfigured or couldn't read the reel — not "this isn't a recipe".
    return {
      recipe: null,
      error:
        "Couldn't fetch this Instagram reel automatically. Paste the reel's caption text to import it, or set APIFY_TOKEN.",
      kind: "extractor_error",
    };
  }

  // ── Caption path ─────────────────────────────────────────────────────────
  const caption = media.caption;
  const captionIsRecipe = caption ? looksLikeRecipe(caption) : false;

  // Diagnostic: always log caption state to Vercel logs.
  console.error(
    caption
      ? `[IG] caption: ${caption.length} chars, looksLikeRecipe=${captionIsRecipe}`
      : "[IG] caption: none returned by scraper"
  );
  if (caption && !captionIsRecipe) {
    console.error(`[IG] caption preview (not a recipe): ${caption.slice(0, 300)}`);
  }

  let captionResult: LlmExtractionResult | null = null;

  if (caption && captionIsRecipe) {
    onStatus(`Caption found (${caption.length} chars). Extracting recipe from caption…`);
    captionResult = await extractWithLlm(caption, url);

    // Caption yielded a complete recipe (both ingredients and instructions).
    if (
      captionResult.recipe &&
      captionResult.recipe.ingredients.length > 0 &&
      captionResult.recipe.instructions.length > 0
    ) {
      return captionResult;
    }

    // Caption partial (missing ingredients or instructions) — try audio.
    if (captionResult.recipe) {
      onStatus("Recipe incomplete in caption. Trying audio for full recipe…");
    } else {
      onStatus("Caption LLM extraction failed. Trying audio…");
    }
  } else {
    // Caption absent or not a recipe — explain before trying audio.
    onStatus(
      !caption
        ? "No caption on this reel. Trying audio…"
        : "Caption doesn't look like a recipe. Trying audio…"
    );
  }

  // ── Audio fallback ────────────────────────────────────────────────────────

  const videoUrl = media.videoUrl;
  console.error(`[IG] video URL from scraper: ${videoUrl ?? "none"}`);

  if (!videoUrl) {
    if (captionResult?.recipe) {
      onStatus(
        "No video available — saving what the caption contained (instructions may be incomplete)."
      );
      return captionResult;
    }
    return {
      recipe: null,
      error:
        "No recipe found in the caption and no video available for audio extraction. Try pasting the reel's caption text instead.",
      kind: "no_recipe",
    };
  }

  onStatus("Downloading video…");
  console.error(`[IG] downloading video (cap=${MAX_VIDEO_BYTES} bytes, timeout=30s)`);
  const videoBuffer = await binaryFetch(videoUrl, {
    maxBytes: MAX_VIDEO_BYTES,
    timeoutMs: 30_000,
  });
  console.error(
    `[IG] video download: ${videoBuffer ? `${videoBuffer.length} bytes` : "FAILED (null)"}`
  );
  if (!videoBuffer) {
    if (captionResult?.recipe) {
      onStatus("Video download failed — saving what was extracted from the caption (instructions may be incomplete).");
      return captionResult;
    }
    return {
      recipe: null,
      error:
        "Could not download the reel video for audio extraction (too large or unavailable).",
      kind: "extractor_error",
    };
  }

  onStatus("Transcribing audio…");
  const transcript = await transcribeWithWhisper(videoBuffer);
  console.error(`[IG] transcript: ${transcript ? `${transcript.length} chars` : "null"}`);
  if (transcript) {
    // Preview so we can confirm Whisper heard recipe narration vs music/garbage.
    console.error(`[IG] transcript preview: ${transcript.slice(0, 300)}`);
  }
  if (!transcript) {
    if (captionResult?.recipe) {
      onStatus("Audio transcription failed — saving what was extracted from the caption (instructions may be incomplete).");
      return captionResult;
    }
    return {
      recipe: null,
      error:
        "Audio transcription failed. Check that GROQ_API_KEY is set and the reel is under 24 MB.",
      kind: "extractor_error",
    };
  }

  // No pre-gate on the transcript: `looksLikeRecipe` is tuned for written
  // captions ("3 tbsp", "Method:") and wrongly rejects spoken narration ("add a
  // couple tablespoons…"). We've already paid for download + transcription, so
  // let the LLM decide and gate on its *output* instead (see audioUseful below).
  // When the caption looked like a recipe, send it alongside the transcript so
  // the LLM keeps the caption's precise ingredients and adds the spoken steps.
  const llmInput =
    captionIsRecipe && caption
      ? `Recipe caption:\n${caption}\n\nVideo audio transcript (use for any cooking steps not in the caption):\n${transcript}`
      : transcript;

  onStatus("Extracting recipe from audio transcript…");
  const audioResult = await extractWithLlm(llmInput, url);
  const ar = audioResult.recipe;
  const audioUseful = !!ar && (ar.ingredients.length > 0 || ar.instructions.length > 0);
  console.error(
    `[IG] audio LLM: recipe=${ar ? "yes" : "no"} ingredients=${ar?.ingredients.length ?? 0} instructions=${ar?.instructions.length ?? 0} useful=${audioUseful}`
  );
  if (audioUseful) return audioResult;

  // Audio yielded nothing usable — a partial caption recipe beats nothing.
  if (captionResult?.recipe) {
    onStatus("Couldn't extract a full recipe from the audio — saving what the caption contained (instructions may be incomplete).");
    return captionResult;
  }
  // LLM ran but found no recipe content (empty result) → no_recipe; otherwise
  // propagate the LLM's extractor_error.
  if (ar) {
    return {
      recipe: null,
      error: "The reel's audio didn't contain a recipe.",
      kind: "no_recipe",
    };
  }
  return audioResult;
}
