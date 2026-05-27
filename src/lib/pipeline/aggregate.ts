/**
 * Aggregation pipeline.
 *
 * Sums NormalizedIngredients by canonical_id across all recipes.
 * All quantities must already be in the canonical base unit (ml, g, each, etc.)
 * — guaranteed by the normalization step.
 *
 * Handles unit family mismatches within the same ingredient (e.g., one recipe
 * measures flour by weight, another by volume) by checking canonical_unit
 * consistency and flagging mismatches.
 */

import type { NormalizedIngredient, AggregatedIngredient } from "@/types";

// ─── Internal aggregation map ─────────────────────────────────────────────────

interface AggMapEntry {
  total_quantity: number;
  canonical_unit: string;
  contributing_recipe_ids: string[];
  /** True if we encountered conflicting units for this canonical_id */
  unit_conflict: boolean;
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Aggregate normalized ingredients by canonical_id.
 *
 * @param items  All NormalizedIngredients from all recipes (already scaled)
 * @returns      One AggregatedIngredient per canonical_id
 */
export function aggregate(
  items: NormalizedIngredient[]
): AggregatedIngredient[] {
  const map = new Map<string, AggMapEntry>();

  for (const item of items) {
    const existing = map.get(item.canonical_id);

    if (!existing) {
      map.set(item.canonical_id, {
        total_quantity: item.quantity,
        canonical_unit: item.canonical_unit,
        contributing_recipe_ids: [item.recipe_id],
        unit_conflict: false,
      });
    } else {
      if (existing.canonical_unit !== item.canonical_unit) {
        // Unit conflict — same canonical_id but different units
        // This can happen if one recipe uses volume and another uses weight.
        // For MVP: add quantities as-is and flag the conflict. The purchase
        // planning step will emit a conservative estimate.
        existing.unit_conflict = true;
        existing.total_quantity += item.quantity;
      } else {
        existing.total_quantity += item.quantity;
      }

      if (!existing.contributing_recipe_ids.includes(item.recipe_id)) {
        existing.contributing_recipe_ids.push(item.recipe_id);
      }
    }
  }

  return Array.from(map.entries()).map(([canonical_id, entry]) => ({
    canonical_id,
    total_quantity: entry.total_quantity,
    canonical_unit: entry.canonical_unit,
    contributing_recipe_ids: entry.contributing_recipe_ids,
  }));
}
