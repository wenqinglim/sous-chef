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
function toCanonicalQuantity(
  quantity: number,
  unit: string | null,
  canonicalUnit: string,
  conversionFactors: Record<string, number>
): number {
  if (!unit) return quantity;

  // Try direct conversion to canonical unit
  const baseResult = toBaseUnit(quantity, unit);
  if (!baseResult) return quantity;

  // If canonical unit matches the base unit, we're done
  if (baseResult.unit === canonicalUnit) return baseResult.value;

  // Use ingredient-specific factor to cross unit families (e.g. g→each for tomato)
  // conversionFactors[unit] = canonical_units per 1 of that unit
  const factor = conversionFactors[baseResult.unit];
  if (factor && factor > 0) return baseResult.value * factor;

  // Try generic same-family conversion as last resort
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
