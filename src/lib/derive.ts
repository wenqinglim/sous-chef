/**
 * Grocery list derivation orchestrator.
 *
 * derive(mealPlan, recipes) → PurchaseItem[]
 *
 * Core principle: the grocery list is a pure derivation, never persisted state.
 * Edit inputs (add/remove recipes, change servings) → re-run derive().
 */

import type { MealPlan, Recipe, PurchaseItem, NormalizedIngredient, UnresolvableIngredient } from "@/types";
import { normalizeRecipe } from "@/lib/pipeline/normalize";
import { aggregate } from "@/lib/pipeline/aggregate";
import { planPurchases } from "@/lib/pipeline/purchase";
import { AISLE_ORDER, type DeriveResult } from "@/lib/format";
export type { DeriveResult } from "@/lib/format";
export { formatForKeep } from "@/lib/format";

/**
 * Derive a complete grocery list from a meal plan and the cached recipe data.
 *
 * @param mealPlan  The meal plan (recipe IDs + target servings)
 * @param recipes   Map of recipe_id → Recipe (pre-fetched/cached)
 */
export async function derive(
  mealPlan: MealPlan,
  recipes: Map<string, Recipe>
): Promise<DeriveResult> {
  const allNormalized: NormalizedIngredient[] = [];
  const allUnresolvable: UnresolvableIngredient[] = [];

  // Normalize each recipe in the meal plan
  for (const entry of mealPlan.recipes) {
    const recipe = recipes.get(entry.recipe_id);
    if (!recipe) {
      console.warn(`[derive] Recipe not found: ${entry.recipe_id}`);
      continue;
    }

    const { normalized, unresolvable } = await normalizeRecipe(
      recipe,
      entry.target_servings
    );

    allNormalized.push(...normalized);
    allUnresolvable.push(...unresolvable);
  }

  // Aggregate across all recipes
  const aggregated = aggregate(allNormalized);

  // Plan purchases
  const items = planPurchases(aggregated);

  // Pre-populate keys in store-navigation order so JS insertion order matches AISLE_ORDER
  const grouped_by_aisle: Record<string, PurchaseItem[]> = {};
  for (const aisle of AISLE_ORDER) {
    grouped_by_aisle[aisle] = [];
  }
  for (const item of items) {
    (grouped_by_aisle[item.aisle] ??= []).push(item);
  }

  // Sort each aisle's items by display_name
  for (const aisle of AISLE_ORDER) {
    grouped_by_aisle[aisle].sort((a, b) =>
      a.display_name.localeCompare(b.display_name)
    );
  }

  return { items, unresolvable: allUnresolvable, grouped_by_aisle };
}
