/**
 * Purchase planning pipeline.
 *
 * Converts aggregated recipe quantities into supermarket purchase units.
 * Emits ALL fields on PurchaseItem from day one — even those the MVP UI
 * doesn't display (leftover_quantity, aisle, is_staple).
 *
 * Rounding rules:
 *   - Always round UP (Math.ceil) to the nearest whole purchase unit
 *   - "bunch" items: always 1 bunch if any is needed
 *   - Eggs: round up to nearest half-dozen (6)
 *   - Everything else: Math.ceil(recipe_quantity / purchase_unit_size)
 */

import type { AggregatedIngredient, PurchaseItem } from "@/types";
import { findById } from "@/lib/registry/registry";
import { convert, toBaseUnit } from "@/lib/units/conversions";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert an aggregated quantity (in canonical_unit) to the ingredient's
 * default_purchase_unit for purchase planning.
 *
 * Returns the quantity expressed in default_purchase_unit terms.
 * Returns the raw total if conversion is not possible.
 */
function toPurchaseUnitQuantity(
  totalQuantity: number,
  canonicalUnit: string,
  purchaseUnit: string,
  conversionFactors: Record<string, number>
): number {
  if (canonicalUnit === purchaseUnit) return totalQuantity;

  // Try conversion_factors table (ingredient-specific)
  const factor = conversionFactors[purchaseUnit];
  if (factor && factor > 0) {
    // conversionFactors[unit] = how many canonical_units per 1 of that unit
    return totalQuantity / factor;
  }

  // Try generic unit conversion (e.g., ml → cups)
  const converted = convert(totalQuantity, canonicalUnit, purchaseUnit);
  if (converted !== null) return converted;

  // Fall back to canonical unit size from toBaseUnit
  const baseA = toBaseUnit(totalQuantity, canonicalUnit);
  const baseB = toBaseUnit(1, purchaseUnit);
  if (baseA && baseB && baseA.unit === baseB.unit) {
    return baseA.value / baseB.value;
  }

  // Cannot convert — return raw quantity
  return totalQuantity;
}

// ─── Special rounding cases ───────────────────────────────────────────────────

function roundPurchaseQuantity(
  quantityInPurchaseUnits: number,
  purchaseUnit: string,
  canonicalId: string
): number {
  if (quantityInPurchaseUnits <= 0) return 0;

  // Eggs: round to nearest half-dozen
  if (canonicalId === "egg") {
    return Math.ceil(quantityInPurchaseUnits / 6) * 6;
  }

  // Bunch items: always 1 if any is needed
  if (purchaseUnit === "bunch") {
    return Math.ceil(quantityInPurchaseUnits);
  }

  return Math.ceil(quantityInPurchaseUnits);
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Convert aggregated ingredients into purchase-ready items.
 *
 * @param aggregated  One entry per canonical_id (from aggregate())
 * @returns           PurchaseItem[] with all fields populated
 */
export function planPurchases(aggregated: AggregatedIngredient[]): PurchaseItem[] {
  const items: PurchaseItem[] = [];

  for (const agg of aggregated) {
    const canonical = findById(agg.canonical_id);
    if (!canonical) {
      // Unknown canonical_id — skip (shouldn't happen in practice)
      continue;
    }

    const purchaseUnit = canonical.default_purchase_unit;
    const purchaseSize = canonical.default_purchase_size;

    // Convert total recipe quantity → how many purchase units are needed (e.g., 1.7 cans)
    const purchaseUnitsNeeded = toPurchaseUnitQuantity(
      agg.total_quantity,
      agg.canonical_unit,
      purchaseUnit,
      canonical.conversion_factors
    );

    // Round up to whole purchase units
    const purchaseQuantity = roundPurchaseQuantity(
      purchaseUnitsNeeded,
      purchaseUnit,
      canonical.id
    );

    // Leftover in canonical units:
    //   purchased = purchaseQuantity × purchaseSize (canonical units per unit)
    //   leftover  = purchased − total_quantity
    const purchasedInCanonical = purchaseQuantity * purchaseSize;
    const leftoverQuantity = Math.max(0, purchasedInCanonical - agg.total_quantity);

    items.push({
      canonical_id: canonical.id,
      display_name: canonical.name,
      recipe_quantity: agg.total_quantity,
      recipe_unit: agg.canonical_unit,
      purchase_unit: purchaseUnit,
      purchase_quantity: purchaseQuantity,
      leftover_quantity: leftoverQuantity,
      aisle: canonical.aisle,
      is_staple: canonical.is_staple,
    });
  }

  return items;
}
