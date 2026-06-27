/**
 * Instagram reel recipe extraction.
 *
 * Recipe websites expose schema.org JSON-LD; Instagram does not. Instead we
 * assume the reel's *caption* contains the full recipe (ingredients + steps),
 * pull that caption out of the fetched page, gate it through a cheap heuristic
 * to reject non-recipe captions, and hand the surviving text to the existing
 * LLM extractor.
 *
 * Caption sourcing is server-fetch only: Instagram frequently serves a login
 * wall to unauthenticated requests and `og:description` is sometimes truncated,
 * so some reels will simply fail to import — that surfaces as an error rather
 * than a bad recipe.
 */

import * as cheerio from "cheerio";
import { extractWithLlm, type LlmExtractionResult } from "@/lib/extractors/llm-fallback";
import {
  extractVideoUrl,
  binaryFetch,
  transcribeWithWhisper,
  MAX_VIDEO_BYTES,
} from "@/lib/extractors/instagram-audio";
import { safeFetch } from "@/lib/extractors/safe-fetch";
import { UNIT_RE_SOURCE } from "@/lib/units/parser";

const INSTAGRAM_HOSTS = new Set([
  "instagram.com",
  "www.instagram.com",
  "m.instagram.com",
  "instagr.am",
  "www.instagr.am",
]);

/**
 * Instagram serves the rich `og:`/JSON-LD caption preview only to recognized
 * link-unfurl crawlers — a generic browser User-Agent gets a login-walled JS
 * shell with no caption. Fetch reels as Facebook's crawler so the caption is
 * present in the HTML. (Used by the /api/extract route for Instagram URLs.)
 */
export const INSTAGRAM_USER_AGENT =
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

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
 * Extract a recipe from a fetched Instagram reel page, with audio fallback.
 *
 * Tries the caption first. If the caption is absent, not a recipe, or yields
 * an incomplete recipe (missing ingredients OR instructions), downloads the
 * reel video (via og:video), transcribes it with Groq Whisper, and runs the
 * transcript through the LLM extractor.
 *
 * When audio fallback fails but the caption yielded a partial recipe, the
 * partial result is returned rather than an error — partial is better than
 * losing what the caption did contain.
 *
 * @param onStatus  Called with human-readable progress strings for UI display.
 */
export async function extractFromInstagramWithAudio(
  html: string,
  url: string,
  onStatus: (msg: string) => void
): Promise<LlmExtractionResult> {
  // ── Caption path ─────────────────────────────────────────────────────────
  const caption = extractInstagramCaption(html);
  let captionResult: LlmExtractionResult | null = null;

  if (caption && looksLikeRecipe(caption)) {
    onStatus("Extracting recipe from caption…");
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
    }
    // LLM itself failed on the caption — also fall through to audio.
  } else {
    // Caption absent or not a recipe — explain before trying audio.
    onStatus(
      !caption
        ? "Caption not found (may be private or login-walled). Trying audio…"
        : "Caption doesn't look like a recipe. Trying audio…"
    );
  }

  // ── Audio fallback ────────────────────────────────────────────────────────

  let videoUrl = extractVideoUrl(html);

  // facebookexternalhit HTML never embeds the raw MP4 URL — only the og:video
  // embed page. Fetch that page (it's a public iframe endpoint) and scan it too.
  if (!videoUrl) {
    const $page = cheerio.load(html);
    const embedUrl =
      $page('meta[property="og:video:secure_url"]').attr("content") ??
      $page('meta[property="og:video"]').attr("content") ??
      null;
    if (embedUrl && embedUrl.includes("instagram.com")) {
      onStatus("Fetching embed page for video URL…");
      try {
        const embedRes = await safeFetch(embedUrl);
        if (embedRes.ok) videoUrl = extractVideoUrl(embedRes.text);
      } catch {
        // embed fetch failure is not fatal
      }
    }
  }

  if (!videoUrl) {
    if (captionResult?.recipe) {
      onStatus("No video URL found in page — saving what was extracted from the caption (instructions may be incomplete).");
      return captionResult;
    }
    return {
      recipe: null,
      error:
        "No recipe found in caption and no video URL available for audio extraction.",
      kind: "no_recipe",
    };
  }

  onStatus("Downloading video…");
  const videoBuffer = await binaryFetch(videoUrl, {
    maxBytes: MAX_VIDEO_BYTES,
    timeoutMs: 30_000,
  });
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

  if (!looksLikeRecipe(transcript)) {
    if (captionResult?.recipe) {
      onStatus("Audio doesn't contain a recipe — saving what was extracted from the caption (instructions may be incomplete).");
      return captionResult;
    }
    return {
      recipe: null,
      error: "The audio transcript doesn't appear to contain a recipe.",
      kind: "no_recipe",
    };
  }

  onStatus("Extracting recipe from audio transcript…");
  const audioResult = await extractWithLlm(transcript, url);
  if (audioResult.recipe) return audioResult;

  // Audio LLM failed — partial caption result is better than nothing.
  if (captionResult?.recipe) {
    onStatus("Audio recipe extraction failed — saving what was extracted from the caption (instructions may be incomplete).");
    return captionResult;
  }
  return audioResult;
}
