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
import { UNIT_TOKENS } from "@/lib/units/parser";

const INSTAGRAM_HOSTS = new Set([
  "instagram.com",
  "www.instagram.com",
  "m.instagram.com",
  "instagr.am",
  "www.instagr.am",
]);

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
 * Instagram's og:description / meta description wraps the caption in a
 * "1,234 likes, 56 comments - username on January 1, 2024: "<caption>""
 * preamble. Strip that engagement/attribution prefix and surrounding quotes.
 */
function stripCaptionPreamble(raw: string): string {
  let s = raw.trim();
  // Drop the "<n> likes, <n> comments - <user> on <date>:" lead-in if present.
  s = s.replace(
    /^[\d,.\sKMB]*likes?[\s\S]*?comments?\s*-\s*[^:]*?:\s*/i,
    ""
  );
  // Unwrap a single layer of surrounding quotes (straight or curly).
  s = s.replace(/^["“”']+/, "").replace(/["“”']+$/, "");
  return s.trim();
}

/**
 * Walk a parsed JSON-LD value looking for the longest caption-ish string field
 * (`caption`, `articleBody`, `description`). Instagram sometimes embeds a fuller
 * caption here than the truncated og:description meta tag.
 */
function findCaptionInJsonLd(value: unknown): string | null {
  let best: string | null = null;
  const consider = (s: unknown) => {
    if (typeof s === "string" && (best === null || s.length > best.length)) {
      best = s;
    }
  };
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      consider(obj.caption);
      consider(obj.articleBody);
      consider(obj.description);
      Object.values(obj).forEach(walk);
    }
  };
  walk(value);
  return best;
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
// directly followed by a known unit token. Reuses the parser's unit vocabulary
// so the heuristic stays in step with what we can actually parse.
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const UNIT_RE_SOURCE = UNIT_TOKENS.map(escapeRegex).join("|");
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
    return {
      recipe: null,
      error:
        "Couldn't read this Instagram reel's caption. It may be private, removed, or require login.",
    };
  }

  if (!looksLikeRecipe(caption)) {
    return {
      recipe: null,
      error:
        "This Instagram caption doesn't look like a recipe. Make sure the reel's caption includes the ingredients and steps.",
    };
  }

  return extractWithLlm(caption, url);
}
