/**
 * Normalization pipeline.
 *
 * For each RecipeIngredient:
 *   1. Parse raw_text → { quantity, unit, name }
 *   2. Clean name and look up in registry
 *   3. Batch-resolve unknowns via LLM fallback
 *   4. Convert quantity to canonical base unit
 *   5. Return NormalizedIngredient or UnresolvableIngredient
 */

import type {
  Recipe,
  RecipeIngredient,
  NormalizedIngredient,
  UnresolvableIngredient,
  CuisineSource,
} from "@/types";
import { parseIngredient } from "@/lib/units/parser";
import { toBaseUnit, convert } from "@/lib/units/conversions";
import { lookupIngredient } from "@/lib/normalizers/lookup";
import { batchNormalizeWithLlm } from "@/lib/normalizers/llm-fallback";
import { findById } from "@/lib/registry/registry";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NormalizeResult {
  normalized: NormalizedIngredient[];
  unresolvable: UnresolvableIngredient[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a quantity + unit into the ingredient's canonical base unit.
 * Returns the original quantity if conversion is not possible.
 */
/**
 * Reduce a parsed unit token to the singular form used as a conversion_factors
 * key (e.g. "slices" → "slice", "leaves" → "leaf", "inches" → "inch").
 */
function singularizeUnit(unit: string): string {
  const u = unit.toLowerCase().trim();
  const irregular: Record<string, string> = { leaves: "leaf" };
  if (irregular[u]) return irregular[u];
  if (u.endsWith("ies")) return u.slice(0, -3) + "y";
  if (u.endsWith("es") && (u.endsWith("ches") || u.endsWith("shes"))) {
    return u.slice(0, -2);
  }
  if (u.endsWith("s") && u.length > 1) return u.slice(0, -1);
  return u;
}

/**
 * Look up an ingredient-specific conversion factor for a unit, trying the unit
 * as written and its singular form. conversionFactors[unit] = canonical units
 * per 1 of that unit.
 */
function factorFor(
  unit: string,
  conversionFactors: Record<string, number>
): number | null {
  const candidates = [unit, unit.toLowerCase().trim(), singularizeUnit(unit)];
  for (const c of candidates) {
    const f = conversionFactors[c];
    if (f && f > 0) return f;
  }
  return null;
}

function toCanonicalQuantity(
  quantity: number,
  unit: string | null,
  canonicalUnit: string,
  conversionFactors: Record<string, number>
): number {
  if (!unit) return quantity;

  // 1. Honor an ingredient-specific factor keyed by the ORIGINAL unit first.
  //    This is what crosses families correctly — e.g. galangal "slice": 5 (g),
  //    or flour "cup": 120 (g). Looking this up by the original unit (not the
  //    base unit) is essential: a "slice" reduces to base "each", which has no
  //    factor, so the "slice" entry would otherwise be ignored.
  const directFactor = factorFor(unit, conversionFactors);
  if (directFactor !== null) return quantity * directFactor;

  // 2. Reduce to the base unit (ml/g/each).
  const baseResult = toBaseUnit(quantity, unit);
  if (!baseResult) return quantity;

  // If canonical unit matches the base unit, we're done
  if (baseResult.unit === canonicalUnit) return baseResult.value;

  // 3. Ingredient-specific factor keyed by the base unit (e.g. g→each tomato)
  const baseFactor = conversionFactors[baseResult.unit];
  if (baseFactor && baseFactor > 0) return baseResult.value * baseFactor;

  // 4. Generic same-family conversion as last resort
  const converted = convert(baseResult.value, baseResult.unit, canonicalUnit);
  if (converted !== null) return converted;

  // Cannot convert — return raw base value as best estimate
  return baseResult.value;
}

// ─── Main normalize function ──────────────────────────────────────────────────

/**
 * Normalize all ingredients in a recipe, applying scaling.
 *
 * @param recipe          Source recipe (used for cuisine_source)
 * @param targetServings  Desired servings — quantities are scaled by target/base
 */
export async function normalizeRecipe(
  recipe: Recipe,
  targetServings: number
): Promise<NormalizeResult> {
  const scaleFactor = targetServings / recipe.base_servings;
  const normalized: NormalizedIngredient[] = [];
  const unresolvable: UnresolvableIngredient[] = [];

  // Step 1: Parse all ingredients
  const parsed = recipe.ingredients.map((ing) => ({
    ing,
    parsed: parseIngredient(ing.raw_text),
  }));

  // Step 2: Lookup pass — try registry first
  const unknowns: { ing: RecipeIngredient; name: string }[] = [];

  for (const { ing, parsed: p } of parsed) {
    if (!p.name) {
      unresolvable.push({
        recipe_id: ing.recipe_id,
        raw_text: ing.raw_text,
        name: ing.name,
        quantity: p.quantity !== null ? p.quantity * scaleFactor : null,
        unit: p.unit,
      });
      continue;
    }

    const lookupResult = lookupIngredient(p.name, recipe.cuisine_source as CuisineSource);

    if (lookupResult.canonical_id) {
      const canonical = lookupResult.canonical ?? findById(lookupResult.canonical_id);
      if (!canonical) continue;

      const scaledQty =
        p.quantity !== null ? p.quantity * scaleFactor : 1; // default 1 for count items

      const canonicalQty = toCanonicalQuantity(
        scaledQty,
        p.unit,
        canonical.canonical_unit,
        canonical.conversion_factors
      );

      normalized.push({
        recipe_id: ing.recipe_id,
        canonical_id: lookupResult.canonical_id,
        quantity: canonicalQty,
        canonical_unit: canonical.canonical_unit,
        raw_text: ing.raw_text,
        resolution_method: "lookup",
      });
    } else {
      unknowns.push({ ing, name: p.name });
    }
  }

  // Step 3: LLM fallback for unknowns
  if (unknowns.length > 0) {
    const llmResults = await batchNormalizeWithLlm(
      unknowns.map((u) => u.name)
    );

    for (const { ing, name } of unknowns) {
      const parsedResult = parsed.find((p) => p.ing === ing)!;
      const p = parsedResult.parsed;
      const llmResult = llmResults.get(name);

      if (llmResult?.canonical_id) {
        const canonical = findById(llmResult.canonical_id);
        if (canonical) {
          const scaledQty =
            p.quantity !== null ? p.quantity * scaleFactor : 1;
          const canonicalQty = toCanonicalQuantity(
            scaledQty,
            p.unit,
            canonical.canonical_unit,
            canonical.conversion_factors
          );

          normalized.push({
            recipe_id: ing.recipe_id,
            canonical_id: llmResult.canonical_id,
            quantity: canonicalQty,
            canonical_unit: canonical.canonical_unit,
            raw_text: ing.raw_text,
            resolution_method: "llm",
          });
          continue;
        }
      }

      // Truly unresolvable
      unresolvable.push({
        recipe_id: ing.recipe_id,
        raw_text: ing.raw_text,
        name,
        quantity: p.quantity !== null ? p.quantity * scaleFactor : null,
        unit: p.unit,
      });
    }
  }

  return { normalized, unresolvable };
}
