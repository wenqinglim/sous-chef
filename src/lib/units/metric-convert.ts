/**
 * Convert a raw ingredient line's leading quantity+unit from US customary
 * (oz, lb, cup, tbsp, tsp, fl oz, pint, quart, gallon, …) to metric (g/kg,
 * ml/L), for the recipe-page "Convert to metric" toggle.
 *
 * Mirrors `rescale.ts`'s approach: find the quantity token with
 * `findQuantityToken`, match the unit word immediately following it, and
 * splice in a replacement — leaving the ingredient name and any trailing
 * prep notes untouched.
 *
 * Units already expressed in metric (g, kg, ml, L, …) are left alone, as are
 * count units (cloves, slices, …) and opaque purchase units (can, bunch, …).
 *
 * Limitations: a parenthetical metric equivalent some sites already provide
 * (e.g. "1 cup (240 ml) milk") is left as-is rather than reconciled with the
 * newly converted leading quantity — same documented scope boundary as
 * `rescaleIngredientLine`'s handling of non-equivalent parens.
 */

import { findQuantityToken } from "./numeric-extract";
import { UNIT_RE_SOURCE } from "./unit-vocab";
import { getUnit, normaliseUnit } from "./conversions";

/** Units already metric — left unconverted. */
const METRIC_UNITS = new Set([
  "ml",
  "milliliter",
  "millilitre",
  "milliliters",
  "millilitres",
  "l",
  "liter",
  "litre",
  "liters",
  "litres",
  "g",
  "gram",
  "grams",
  "gr.",
  "mg",
  "milligram",
  "milligrams",
  "kg",
  "kilogram",
  "kilograms",
]);

/** True if this unit is a weight/volume unit that isn't already metric. */
export function isConvertibleToMetric(rawUnit: string): boolean {
  const def = getUnit(rawUnit);
  if (!def) return false;
  if (def.family !== "volume" && def.family !== "weight") return false;
  return !METRIC_UNITS.has(normaliseUnit(rawUnit));
}

function round(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

/** Pick a display unit (g/kg or ml/L) and format a base-unit value for it. */
function formatBaseValue(
  baseValue: number,
  base: "g" | "ml",
  targetUnit: "g" | "kg" | "ml" | "L"
): string {
  if (targetUnit === "kg" || targetUnit === "L") {
    return String(round(baseValue / 1000, 2));
  }
  return String(round(baseValue, 0));
}

function pickTargetUnit(base: "g" | "ml", maxBaseValue: number): "g" | "kg" | "ml" | "L" {
  if (base === "g") return maxBaseValue >= 1000 ? "kg" : "g";
  return maxBaseValue >= 1000 ? "L" : "ml";
}

/**
 * Convert the leading (or name-first-fallback) quantity+unit of an
 * ingredient line to metric. Returns the original text unchanged if no
 * quantity is found, or the unit isn't a convertible US customary unit.
 */
export function convertLineToMetric(rawText: string): string {
  if (!rawText) return rawText;

  const match = findQuantityToken(rawText);
  if (!match) return rawText;

  const prefix = rawText.slice(0, match.index);
  const afterNumber = rawText.slice(match.index + match.consumed);

  const unitMatch = afterNumber.match(new RegExp(`^(\\s*)(${UNIT_RE_SOURCE})\\b`, "i"));
  if (!unitMatch) return rawText;

  const unitText = unitMatch[2];
  if (!isConvertibleToMetric(unitText)) return rawText;

  const def = getUnit(unitText)!;
  const base = def.base as "g" | "ml";
  const tail = afterNumber.slice(unitMatch[0].length);

  const loBase = match.lo * def.toBase;
  const hiBase = match.hi != null ? match.hi * def.toBase : null;
  const targetUnit = pickTargetUnit(base, Math.max(loBase, hiBase ?? 0));

  const loStr = formatBaseValue(loBase, base, targetUnit);
  if (hiBase != null) {
    const hiStr = formatBaseValue(hiBase, base, targetUnit);
    return `${prefix}${loStr}-${hiStr} ${targetUnit}${tail}`;
  }
  return `${prefix}${loStr} ${targetUnit}${tail}`;
}
