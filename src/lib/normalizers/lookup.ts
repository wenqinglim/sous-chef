/**
 * Normalization lookup.
 *
 * Given a raw parsed ingredient name and metadata about the recipe source,
 * resolves it to a CanonicalIngredient (or null for unknowns to be sent to LLM).
 *
 * Lookup pipeline:
 *   1. Clean the name (strip native-script parens, substitution alternatives, prep notes)
 *   2. Direct alias lookup in registry
 *   3. Retry after stripping common adjectives (fresh, dried, ground…)
 *   4. Retry after stripping trailing plural 's'
 *   5. Return null → caller routes to LLM fallback
 *
 * Soy sauce disambiguation:
 *   Unqualified "soy sauce" → soy_sauce_light when cuisine_source === 'asian',
 *   soy_sauce_all_purpose otherwise.
 */

import type { CanonicalIngredient, CuisineSource, NormalizationResult } from "@/types";
import { findByAlias, findById, normaliseForLookup } from "@/lib/registry/registry";

// ─── Adjectives that don't affect ingredient identity ─────────────────────────

const STRIPPABLE_ADJECTIVES = [
  "fresh",
  "dried",
  "ground",
  "whole",
  "raw",
  "cooked",
  "frozen",
  "thawed",
  "canned",
  "tinned",
  "low-sodium",
  "low sodium",
  "reduced-sodium",
  "reduced sodium",
  "unsalted",
  "salted",
  "roasted",
  "toasted",
  "minced",
  "chopped",
  "sliced",
  "grated",
  "peeled",
  "trimmed",
  "crushed",
  // Size and quality descriptors
  "small",
  "medium",
  "large",
  "good",
  "quality",
];

const ADJECTIVE_RE = new RegExp(
  `^(?:${STRIPPABLE_ADJECTIVES.map((a) => a.replace("-", "[-\\s]?")).join("|")})\\s+`,
  "i"
);

// ─── Asian-cuisine domain detection ──────────────────────────────────────────

const ASIAN_CUISINE_DOMAINS = [
  "woksoflife.com",
  "madewithlau.com",
  "hot-thai-kitchen.com",
  "hotthaikitchen.com",
];

/**
 * Infer cuisine source from recipe URL.
 * "asian" means Chinese/Thai/Korean/etc. cuisine sources where
 * bare "soy sauce" defaults to light soy.
 *
 * Known Asian-cuisine domains are matched as a fast path; any other domain
 * returns "unknown" rather than assuming "western" — Sous-Chef now accepts
 * arbitrary recipe sites, so the URL is no longer a reliable cuisine signal.
 * Callers (e.g. schema.org's recipeCuisine field) can refine this later.
 */
export function inferCuisineSource(url: string): CuisineSource {
  const lower = url.toLowerCase();
  return ASIAN_CUISINE_DOMAINS.some((d) => lower.includes(d)) ? "asian" : "unknown";
}

// ─── Soy sauce disambiguation ─────────────────────────────────────────────────

const UNQUALIFIED_SOY_SAUCE_RE = /^soy\s+sauce$/i;

function disambiguateSoySauce(
  name: string,
  cuisineSource: CuisineSource
): CanonicalIngredient | null {
  if (!UNQUALIFIED_SOY_SAUCE_RE.test(name.trim())) return null;
  // Asian sources → light soy; "western" and "unknown" both default to
  // all-purpose (the safe choice when the cuisine is unconfirmed).
  const targetId =
    cuisineSource === "asian" ? "soy_sauce_light" : "soy_sauce_all_purpose";
  return findById(targetId);
}

// ─── Parenthetical stripping ──────────────────────────────────────────────────

/** Remove all parenthetical groups: handles native-script notes, prep notes, substitutions. */
function stripParentheticals(name: string): string {
  return name.replace(/\s*\([^)]*\)/g, "").trim();
}

// ─── Leading determiners / trailing purpose phrases ───────────────────────────

/**
 * Leading quantity words and determiners that recipe writers use but that don't
 * change ingredient identity: "half a medium onion", "a pinch of salt".
 */
const LEADING_DETERMINER_RE =
  /^(?:half\s+of\s+a|half\s+a|half|a\s+few|a\s+pinch\s+of|a\s+handful\s+of|some|few|a|an|the)\s+/i;

/**
 * Trailing purpose phrases (often with no preceding comma): "parmesan for serving",
 * "cilantro for garnish", "butter, divided", "more as needed".
 */
const PURPOSE_PHRASE_RE =
  /\s+(?:for\s+(?:serving|garnish|the\s+\w+|dusting|drizzling)|to\s+(?:serve|garnish|finish)|plus\s+more.*|divided|as\s+needed|if\s+desired|optional)\s*$/i;

/** Strip leading determiners and trailing purpose phrases (looped). */
function stripDeterminersAndPurpose(name: string): string {
  let s = name.trim();
  let prev = "";
  while (s !== prev) {
    prev = s;
    s = s.replace(LEADING_DETERMINER_RE, "").replace(PURPOSE_PHRASE_RE, "").trim();
  }
  return s;
}

/**
 * Produce singular candidates for the final word of a phrase. Recipe plurals are
 * irregular ("chilies" → "chili", "leaves" → "leaf", "tomatoes" → "tomato"),
 * so we try several rules and let the registry decide which one matches.
 */
function singularVariants(name: string): string[] {
  const trimmed = name.trim();
  if (!trimmed) return [];
  const parts = trimmed.split(/\s+/);
  const last = parts[parts.length - 1];
  const prefix = parts.slice(0, -1).join(" ");
  const join = (w: string) => (prefix ? `${prefix} ${w}` : w);

  const wordVariants = new Set<string>();
  if (last.endsWith("ies") && last.length > 3) {
    wordVariants.add(last.slice(0, -3) + "y"); // berries → berry
    wordVariants.add(last.slice(0, -3) + "i"); // chilies → chili
    wordVariants.add(last.slice(0, -2)); // chilies → chilie (last resort)
  }
  if (last === "leaves") wordVariants.add("leaf");
  if (last.endsWith("es") && last.length > 2) wordVariants.add(last.slice(0, -2)); // tomatoes → tomato
  if (last.endsWith("s") && last.length > 1) wordVariants.add(last.slice(0, -1)); // onions → onion

  return Array.from(wordVariants)
    .filter((w) => w.length > 1)
    .map(join);
}

// ─── Main lookup function ─────────────────────────────────────────────────────

/**
 * Try to resolve a raw ingredient name to a canonical ingredient.
 *
 * @param rawName       Parsed ingredient name (already has quantity/unit stripped)
 * @param cuisineSource From the recipe URL — used for soy sauce disambiguation
 */
export function lookupIngredient(
  rawName: string,
  cuisineSource: CuisineSource = "unknown"
): NormalizationResult {
  const name = stripDeterminersAndPurpose(stripParentheticals(rawName));

  // Step 1: Soy sauce disambiguation
  const soySauceMatch = disambiguateSoySauce(name, cuisineSource);
  if (soySauceMatch) {
    return {
      canonical_id: soySauceMatch.id,
      canonical: soySauceMatch,
      method: "lookup",
      confidence: 0.95,
    };
  }

  // Step 2: Direct alias lookup
  const direct = findByAlias(name);
  if (direct) {
    return {
      canonical_id: direct.id,
      canonical: direct,
      method: "lookup",
      confidence: 1.0,
    };
  }

  // Step 3: Strip leading strippable adjectives in a loop and retry.
  // Loop handles multi-adjective inputs like "good quality olive oil".
  let stripped = name;
  let prev = "";
  while (stripped !== prev) {
    prev = stripped;
    stripped = stripped.replace(ADJECTIVE_RE, "").trim();
  }
  if (stripped !== name && stripped.length > 0) {
    const afterAdj = findByAlias(stripped);
    if (afterAdj) {
      return {
        canonical_id: afterAdj.id,
        canonical: afterAdj,
        method: "lookup",
        confidence: 0.95,
      };
    }
  }

  // Step 4: Try singular variants of the name (and of the adjective-stripped
  // name) — handles irregular recipe plurals like "chilies"/"leaves"/"tomatoes".
  for (const candidate of [
    ...singularVariants(name),
    ...singularVariants(stripped),
  ]) {
    if (candidate.length <= 2) continue;
    const match = findByAlias(candidate);
    if (match) {
      return {
        canonical_id: match.id,
        canonical: match,
        method: "lookup",
        confidence: 0.9,
      };
    }
  }

  // No match — caller should route to LLM fallback
  return {
    canonical_id: null,
    canonical: null,
    method: "unknown",
    confidence: 0,
  };
}

/**
 * Normalise a raw ingredient name for display purposes.
 * Strips quantity/unit/prep context but keeps the meaningful name portion.
 */
export function normaliseDisplayName(rawName: string): string {
  return normaliseForLookup(rawName);
}
