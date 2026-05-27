/**
 * Grocery list derivation orchestrator.
 *
 * derive(mealPlan, recipes) → PurchaseItem[]
 *
 * Core principle: the grocery list is a pure derivation, never persisted state.
 * Edit inputs (add/remove recipes, change servings) → re-run derive().
 */

import type { MealPlan, Recipe, PurchaseItem, UnresolvableIngredient, NormalizedIngredient } from "@/types";
import { normalizeRecipe } from "@/lib/pipeline/normalize";
import { aggregate } from "@/lib/pipeline/aggregate";
import { planPurchases } from "@/lib/pipeline/purchase";

export interface DeriveResult {
  items: PurchaseItem[];
  unresolvable: UnresolvableIngredient[];
  /** Items grouped by aisle, sorted in store-navigation order */
  grouped_by_aisle: Record<string, PurchaseItem[]>;
}

/** Preferred aisle display order */
const AISLE_ORDER = [
  "produce",
  "meat",
  "seafood",
  "dairy",
  "deli",
  "bakery",
  "frozen",
  "asian_grocery",
  "pantry",
  "condiments",
  "beverages",
  "other",
];

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

  // Group by aisle in display order
  const grouped_by_aisle: Record<string, PurchaseItem[]> = {};
  for (const item of items) {
    if (!grouped_by_aisle[item.aisle]) {
      grouped_by_aisle[item.aisle] = [];
    }
    grouped_by_aisle[item.aisle].push(item);
  }

  // Sort each aisle's items by display_name
  for (const aisle of Object.keys(grouped_by_aisle)) {
    grouped_by_aisle[aisle].sort((a, b) =>
      a.display_name.localeCompare(b.display_name)
    );
  }

  return { items, unresolvable: allUnresolvable, grouped_by_aisle };
}

/**
 * Format the grocery list as plain text for copying into Google Keep.
 * Google Keep turns line breaks into checklist items.
 *
 * @param result  Output from derive()
 * @param title   Optional title for the list
 */
export function formatForKeep(result: DeriveResult, title?: string): string {
  const lines: string[] = [];

  if (title) {
    lines.push(`🛒 ${title}`);
    lines.push("");
  }

  // Non-staple items by aisle
  for (const aisle of AISLE_ORDER) {
    const aisleItems = result.grouped_by_aisle[aisle]?.filter(
      (i) => !i.is_staple
    );
    if (!aisleItems || aisleItems.length === 0) continue;

    lines.push(aisle.toUpperCase().replace(/_/g, " "));
    for (const item of aisleItems) {
      lines.push(formatItem(item));
    }
    lines.push("");
  }

  // Staple items at the bottom
  const staples = result.items.filter((i) => i.is_staple);
  if (staples.length > 0) {
    lines.push("PANTRY STAPLES (check stock)");
    for (const item of staples.sort((a, b) =>
      a.display_name.localeCompare(b.display_name)
    )) {
      lines.push(`  — ${item.display_name}`);
    }
  }

  return lines.join("\n");
}

function formatItem(item: PurchaseItem): string {
  const qty = item.purchase_quantity;
  const unit = item.purchase_unit;
  const name = item.display_name;

  if (qty === 1) {
    return `  ${qty} ${unit}  ${name}`;
  }
  return `  ${qty} ${unit}s  ${name}`;
}
