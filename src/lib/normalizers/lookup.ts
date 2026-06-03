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
 */
export function inferCuisineSource(url: string): CuisineSource {
  const lower = url.toLowerCase();
  return ASIAN_CUISINE_DOMAINS.some((d) => lower.includes(d)) ? "asian" : "western";
}

// ─── Soy sauce disambiguation ─────────────────────────────────────────────────

const UNQUALIFIED_SOY_SAUCE_RE = /^soy\s+sauce$/i;

function disambiguateSoySauce(
  name: string,
  cuisineSource: CuisineSource
): CanonicalIngredient | null {
  if (!UNQUALIFIED_SOY_SAUCE_RE.test(name.trim())) return null;
  const targetId =
    cuisineSource === "asian" ? "soy_sauce_light" : "soy_sauce_all_purpose";
  return findById(targetId);
}

// ─── Parenthetical stripping ──────────────────────────────────────────────────

/** Remove all parenthetical groups: handles native-script notes, prep notes, substitutions. */
function stripParentheticals(name: string): string {
  return name.replace(/\s*\([^)]*\)/g, "").trim();
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
  const name = stripParentheticals(rawName);

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

  // Step 4: Strip trailing plural 's' and retry
  const singular = name.replace(/s$/, "").trim();
  if (singular !== name && singular.length > 2) {
    const afterSingular = findByAlias(singular);
    if (afterSingular) {
      return {
        canonical_id: afterSingular.id,
        canonical: afterSingular,
        method: "lookup",
        confidence: 0.9,
      };
    }
  }

  // Step 5: Strip adjective then also try singular
  if (stripped !== name && stripped.endsWith("s")) {
    const adjSingular = stripped.slice(0, -1).trim();
    if (adjSingular.length > 2) {
      const afterBoth = findByAlias(adjSingular);
      if (afterBoth) {
        return {
          canonical_id: afterBoth.id,
          canonical: afterBoth,
          method: "lookup",
          confidence: 0.9,
        };
      }
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
