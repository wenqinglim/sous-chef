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
 * count units (cloves, slices, …), opaque purchase units (can, bunch, …), and
 * length units repurposed as weight approximations for ginger sizing (inch,
 * cm — see `LENGTH_AS_WEIGHT_UNITS` below).
 *
 * If a parenthetical metric equivalent is already present (e.g. the "(240
 * ml)" in "1 cup (240 ml) milk", or one kept in sync by the servings scaler),
 * the leading quantity is left unconverted rather than producing two
 * conflicting metric numbers on the same line.
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

/** Alternation source matching any metric unit word, for use inside a RegExp. */
const METRIC_UNIT_RE_SOURCE = [...METRIC_UNITS]
  .sort((a, b) => b.length - a.length)
  .map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");

/**
 * Length units repurposed in `conversions.ts` as weight-family approximations
 * for ginger sizing (e.g. `inch` → 6g). They aren't real weight units — `cm`
 * in particular is already metric — so they must never be treated as
 * convertible even though `getUnit(...).family === "weight"`.
 */
const LENGTH_AS_WEIGHT_UNITS = new Set(["inch", "inches", '"', "cm"]);

/** True if this unit is a weight/volume unit that isn't already metric. */
export function isConvertibleToMetric(rawUnit: string): boolean {
  const def = getUnit(rawUnit);
  if (!def) return false;
  if (def.family !== "volume" && def.family !== "weight") return false;
  const normalised = normaliseUnit(rawUnit);
  if (LENGTH_AS_WEIGHT_UNITS.has(normalised)) return false;
  return !METRIC_UNITS.has(normalised);
}

function round(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

/** Pick a display unit (g/kg or ml/L) and format a base-unit value for it. */
function formatBaseValue(
  baseValue: number,
  targetUnit: "g" | "kg" | "ml" | "L"
): string {
  if (targetUnit === "kg" || targetUnit === "L") {
    return String(round(baseValue / 1000, 2));
  }
  return String(round(baseValue, 0));
}

/**
 * A parenthetical metric equivalent immediately following the unit, e.g. the
 * "(240 ml)" in "1 cup (240 ml) milk". When present, the leading quantity is
 * left unconverted rather than producing two conflicting metric numbers on
 * one line (this also covers the servings-scaler composing with this toggle,
 * since the scaler keeps such parens in sync with the scaled leading qty).
 */
const PAREN_METRIC_EQUIVALENT_RE = new RegExp(
  `^\\s*\\([0-9.,/¼½¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞\\s]+\\s*(${METRIC_UNIT_RE_SOURCE})\\s*\\)`,
  "i"
);

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

  if (PAREN_METRIC_EQUIVALENT_RE.test(tail)) return rawText;

  const loBase = match.lo * def.toBase;
  const hiBase = match.hi != null ? match.hi * def.toBase : null;
  const targetUnit = pickTargetUnit(base, Math.max(loBase, hiBase ?? 0));

  const loStr = formatBaseValue(loBase, targetUnit);
  if (hiBase != null) {
    const hiStr = formatBaseValue(hiBase, targetUnit);
    return `${prefix}${loStr}-${hiStr} ${targetUnit}${tail}`;
  }
  return `${prefix}${loStr} ${targetUnit}${tail}`;
}
