/**
 * Purchase planning pipeline.
 *
 * Converts aggregated recipe quantities into supermarket purchase units.
 * Emits ALL fields on PurchaseItem from day one — even those the MVP UI
 * doesn't display (leftover_quantity, aisle, is_staple).
 *
 * Rounding: always Math.ceil to the nearest whole purchase unit.
 */

import type { AggregatedIngredient, PurchaseItem } from "@/types";
import { findById } from "@/lib/registry/registry";
import { convert, toBaseUnit } from "@/lib/units/conversions";

// ─── Opaque purchase unit guardrail ───────────────────────────────────────────

// Units that represent physical containers with no fixed canonical-unit mapping.
// Without a realistic purchase_size these would divide raw ml/g by 1, yielding
// absurd quantities like "52 bottles lime juice".
const OPAQUE_PURCHASE_UNITS = new Set([
  "bottle", "jar", "tub", "can", "tin", "package", "packet", "pkg",
  "block", "bag", "carton", "box", "tube",
]);

// Fallback container sizes (canonical units per 1 purchase unit) used only
// when an ingredient's default_purchase_size is the unhelpful value of 1.
const OPAQUE_UNIT_DEFAULT_SIZE: Record<string, { ml: number; g: number }> = {
  bottle:  { ml: 250, g: 250 },
  jar:     { ml: 200, g: 200 },
  tub:     { ml: 300, g: 300 },
  can:     { ml: 400, g: 400 },
  tin:     { ml: 400, g: 400 },
  carton:  { ml: 1000, g: 1000 },
  block:   { ml: 300, g: 300 },
  bag:     { ml: 250, g: 250 },
  box:     { ml: 250, g: 250 },
  package: { ml: 250, g: 250 },
  packet:  { ml: 250, g: 250 },
  pkg:     { ml: 250, g: 250 },
  tube:    { ml: 150, g: 150 },
};

/**
 * Returns the effective purchase size for an ingredient.
 * For opaque container units with size <= 1, falls back to a realistic default
 * so we never divide a ml/g total by 1.
 */
function effectivePurchaseSize(
  purchaseUnit: string,
  purchaseSize: number,
  canonicalUnit: string
): number {
  if (purchaseSize > 1) return purchaseSize;
  if (OPAQUE_PURCHASE_UNITS.has(purchaseUnit)) {
    const defaults = OPAQUE_UNIT_DEFAULT_SIZE[purchaseUnit];
    if (defaults) {
      return defaults[canonicalUnit as "ml" | "g"] ?? defaults.ml;
    }
  }
  return purchaseSize > 0 ? purchaseSize : 1;
}

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
  purchaseSize: number,
  conversionFactors: Record<string, number>
): number {
  if (canonicalUnit === purchaseUnit) {
    // Same unit, but the purchase comes in packs of `purchaseSize`
    // (e.g. eggs counted "each" sold by the dozen would use the factor path;
    //  here purchaseSize is 1 for genuine 1:1 units).
    return purchaseSize > 0 ? totalQuantity / purchaseSize : totalQuantity;
  }

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

  // Final fallback: default_purchase_size is the number of canonical units in
  // one purchase unit (e.g. 500 g per spaghetti package). For opaque container
  // units (bottle/jar/tub/…) with size <= 1, use a realistic default size so
  // we never yield absurd quantities like "52 bottles".
  const size = effectivePurchaseSize(purchaseUnit, purchaseSize, canonicalUnit);
  return totalQuantity / size;
}

// ─── Special rounding cases ───────────────────────────────────────────────────

function roundPurchaseQuantity(quantityInPurchaseUnits: number): number {
  if (quantityInPurchaseUnits <= 0) return 0;
  return Math.ceil(quantityInPurchaseUnits);
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Convert aggregated ingredients into purchase-ready items.
 *
 * @param aggregated  One entry per canonical_id (from aggregate())
 * @returns           PurchaseItem[] with all fields populated
 *
 * Rounding rules (revised):
 *   - Always Math.ceil to nearest whole purchase unit
 *   - "bunch" items: handled naturally by Math.ceil
 *   - Eggs: Math.ceil to nearest dozen (purchase_unit is already "dozen")
 *   - Everything else: Math.ceil(recipe_quantity / purchase_unit_size)
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
    // Use the same effective size for both conversion and leftover math so they stay consistent.
    const resolvedSize = effectivePurchaseSize(purchaseUnit, purchaseSize, agg.canonical_unit);

    // Convert total recipe quantity → how many purchase units are needed (e.g., 1.7 cans)
    const purchaseUnitsNeeded = toPurchaseUnitQuantity(
      agg.total_quantity,
      agg.canonical_unit,
      purchaseUnit,
      purchaseSize,
      canonical.conversion_factors
    );

    // Round up to whole purchase units
    const purchaseQuantity = roundPurchaseQuantity(purchaseUnitsNeeded);

    // Leftover in canonical units:
    //   purchased = purchaseQuantity × resolvedSize (canonical units per unit)
    //   leftover  = purchased − total_quantity
    const purchasedInCanonical = purchaseQuantity * resolvedSize;
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
