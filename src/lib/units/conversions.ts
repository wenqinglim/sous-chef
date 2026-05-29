/**
 * Unit conversion utilities.
 *
 * Base units: ml (volume), g (weight), each (count).
 * All conversions reduce TO these base units so that quantities from different
 * recipes (metric vs imperial) can be summed before aggregation.
 *
 * IMPORTANT: fl oz must be matched BEFORE bare "oz" — see unitToBase().
 */

/** Canonical base unit for each unit family */
export type UnitFamily = "volume" | "weight" | "count" | "other";

export interface UnitDefinition {
  base: string; // "ml" | "g" | "each"
  family: UnitFamily;
  /** How many base units does 1 of this unit equal? */
  toBase: number;
}

/**
 * Map of lowercased/normalised unit name → definition.
 * Order matters for aliases that are substrings of each other — fl oz before oz.
 */
const UNITS: Record<string, UnitDefinition> = {
  // ── Volume ──────────────────────────────────────────────────────────────────
  ml: { base: "ml", family: "volume", toBase: 1 },
  milliliter: { base: "ml", family: "volume", toBase: 1 },
  millilitre: { base: "ml", family: "volume", toBase: 1 },
  milliliters: { base: "ml", family: "volume", toBase: 1 },
  millilitres: { base: "ml", family: "volume", toBase: 1 },

  l: { base: "ml", family: "volume", toBase: 1000 },
  liter: { base: "ml", family: "volume", toBase: 1000 },
  litre: { base: "ml", family: "volume", toBase: 1000 },
  liters: { base: "ml", family: "volume", toBase: 1000 },
  litres: { base: "ml", family: "volume", toBase: 1000 },

  tsp: { base: "ml", family: "volume", toBase: 4.929 },
  teaspoon: { base: "ml", family: "volume", toBase: 4.929 },
  teaspoons: { base: "ml", family: "volume", toBase: 4.929 },
  "t.": { base: "ml", family: "volume", toBase: 4.929 },

  tbsp: { base: "ml", family: "volume", toBase: 14.787 },
  tablespoon: { base: "ml", family: "volume", toBase: 14.787 },
  tablespoons: { base: "ml", family: "volume", toBase: 14.787 },
  "tbsp.": { base: "ml", family: "volume", toBase: 14.787 },
  "tbs.": { base: "ml", family: "volume", toBase: 14.787 },
  tbs: { base: "ml", family: "volume", toBase: 14.787 },
  "t": { base: "ml", family: "volume", toBase: 14.787 },

  // fl oz must come before bare "oz" to prevent prefix collision
  "fl oz": { base: "ml", family: "volume", toBase: 29.574 },
  "fl. oz": { base: "ml", family: "volume", toBase: 29.574 },
  "fl. oz.": { base: "ml", family: "volume", toBase: 29.574 },
  "fluid oz": { base: "ml", family: "volume", toBase: 29.574 },
  "fluid ounce": { base: "ml", family: "volume", toBase: 29.574 },
  "fluid ounces": { base: "ml", family: "volume", toBase: 29.574 },
  "floz": { base: "ml", family: "volume", toBase: 29.574 },

  cup: { base: "ml", family: "volume", toBase: 236.588 },
  cups: { base: "ml", family: "volume", toBase: 236.588 },
  "c.": { base: "ml", family: "volume", toBase: 236.588 },

  pint: { base: "ml", family: "volume", toBase: 473.176 },
  pints: { base: "ml", family: "volume", toBase: 473.176 },
  pt: { base: "ml", family: "volume", toBase: 473.176 },

  quart: { base: "ml", family: "volume", toBase: 946.353 },
  quarts: { base: "ml", family: "volume", toBase: 946.353 },
  qt: { base: "ml", family: "volume", toBase: 946.353 },

  gallon: { base: "ml", family: "volume", toBase: 3785.41 },
  gallons: { base: "ml", family: "volume", toBase: 3785.41 },
  gal: { base: "ml", family: "volume", toBase: 3785.41 },

  // ── Weight ───────────────────────────────────────────────────────────────────
  g: { base: "g", family: "weight", toBase: 1 },
  gram: { base: "g", family: "weight", toBase: 1 },
  grams: { base: "g", family: "weight", toBase: 1 },
  "gr.": { base: "g", family: "weight", toBase: 1 },

  mg: { base: "g", family: "weight", toBase: 0.001 },
  milligram: { base: "g", family: "weight", toBase: 0.001 },
  milligrams: { base: "g", family: "weight", toBase: 0.001 },

  kg: { base: "g", family: "weight", toBase: 1000 },
  kilogram: { base: "g", family: "weight", toBase: 1000 },
  kilograms: { base: "g", family: "weight", toBase: 1000 },

  oz: { base: "g", family: "weight", toBase: 28.3495 },
  ounce: { base: "g", family: "weight", toBase: 28.3495 },
  ounces: { base: "g", family: "weight", toBase: 28.3495 },
  "oz.": { base: "g", family: "weight", toBase: 28.3495 },

  lb: { base: "g", family: "weight", toBase: 453.592 },
  lbs: { base: "g", family: "weight", toBase: 453.592 },
  pound: { base: "g", family: "weight", toBase: 453.592 },
  pounds: { base: "g", family: "weight", toBase: 453.592 },
  "lb.": { base: "g", family: "weight", toBase: 453.592 },

  // Special weight approximations
  /** US stick of butter = 1/2 cup = 113g */
  stick: { base: "g", family: "weight", toBase: 113 },
  sticks: { base: "g", family: "weight", toBase: 113 },

  /** 1 inch piece of ginger root ≈ 6g */
  inch: { base: "g", family: "weight", toBase: 6 },
  inches: { base: "g", family: "weight", toBase: 6 },
  '"': { base: "g", family: "weight", toBase: 6 }, // inch symbol

  /** 1 cm piece of ginger root ≈ 2.4g */
  cm: { base: "g", family: "weight", toBase: 2.4 },

  /** "knob" of ginger ≈ 10g (approximate; flagged uncertain) */
  knob: { base: "g", family: "weight", toBase: 10 },
  knobs: { base: "g", family: "weight", toBase: 10 },

  // ── Count ────────────────────────────────────────────────────────────────────
  each: { base: "each", family: "count", toBase: 1 },
  whole: { base: "each", family: "count", toBase: 1 },
  piece: { base: "each", family: "count", toBase: 1 },
  pieces: { base: "each", family: "count", toBase: 1 },
  clove: { base: "each", family: "count", toBase: 1 },
  cloves: { base: "each", family: "count", toBase: 1 },
  slice: { base: "each", family: "count", toBase: 1 },
  slices: { base: "each", family: "count", toBase: 1 },
  sprig: { base: "each", family: "count", toBase: 1 },
  sprigs: { base: "each", family: "count", toBase: 1 },
  stalk: { base: "each", family: "count", toBase: 1 },
  stalks: { base: "each", family: "count", toBase: 1 },
  stem: { base: "each", family: "count", toBase: 1 },
  stems: { base: "each", family: "count", toBase: 1 },
  leaf: { base: "each", family: "count", toBase: 1 },
  leaves: { base: "each", family: "count", toBase: 1 },
  head: { base: "each", family: "count", toBase: 1 },
  heads: { base: "each", family: "count", toBase: 1 },
  ear: { base: "each", family: "count", toBase: 1 },
  ears: { base: "each", family: "count", toBase: 1 },
  fillet: { base: "each", family: "count", toBase: 1 },
  fillets: { base: "each", family: "count", toBase: 1 },
  sheet: { base: "each", family: "count", toBase: 1 },
  sheets: { base: "each", family: "count", toBase: 1 },

  // ── Other (opaque purchase units — not converted to base) ────────────────────
  bunch: { base: "bunch", family: "other", toBase: 1 },
  bunches: { base: "bunch", family: "other", toBase: 1 },
  can: { base: "can", family: "other", toBase: 1 },
  cans: { base: "can", family: "other", toBase: 1 },
  tin: { base: "can", family: "other", toBase: 1 },
  tins: { base: "can", family: "other", toBase: 1 },
  package: { base: "package", family: "other", toBase: 1 },
  packages: { base: "package", family: "other", toBase: 1 },
  pkg: { base: "package", family: "other", toBase: 1 },
  packet: { base: "package", family: "other", toBase: 1 },
  packets: { base: "package", family: "other", toBase: 1 },
  bag: { base: "bag", family: "other", toBase: 1 },
  bags: { base: "bag", family: "other", toBase: 1 },
  bottle: { base: "bottle", family: "other", toBase: 1 },
  bottles: { base: "bottle", family: "other", toBase: 1 },
  block: { base: "block", family: "other", toBase: 1 },
  blocks: { base: "block", family: "other", toBase: 1 },
  dozen: { base: "dozen", family: "other", toBase: 1 },
  dozens: { base: "dozen", family: "other", toBase: 1 },
};

/** Normalise a unit string to our canonical lowercase form */
export function normaliseUnit(raw: string): string {
  return raw.toLowerCase().trim();
}

/**
 * Look up a unit by name.
 * Returns null if unknown — callers should treat unknown units as opaque.
 */
export function getUnit(rawUnit: string): UnitDefinition | null {
  return UNITS[normaliseUnit(rawUnit)] ?? null;
}

/**
 * Convert a quantity from one unit to another.
 * Both units must belong to the same family (volume↔volume, weight↔weight).
 * For cross-family conversion (volume↔weight) you need a density — call
 * convertCrossFamily() instead.
 *
 * Returns null if conversion is not possible.
 */
export function convert(
  quantity: number,
  fromUnit: string,
  toUnit: string
): number | null {
  const from = getUnit(fromUnit);
  const to = getUnit(toUnit);

  if (!from || !to) return null;
  if (from.base !== to.base && from.family !== to.family) return null;
  if (from.family !== to.family) return null;

  // Convert to base then to target
  const inBase = quantity * from.toBase;
  return inBase / to.toBase;
}

/**
 * Convert to the canonical base unit (ml, g, or each).
 * Returns { value, unit } so the caller knows which base unit was used.
 */
export function toBaseUnit(
  quantity: number,
  unit: string
): { value: number; unit: string } | null {
  const def = getUnit(unit);
  if (!def) return null;
  return { value: quantity * def.toBase, unit: def.base };
}

/**
 * Cross-family conversion: volume ↔ weight using density.
 * @param density  g per ml
 */
export function convertCrossFamily(
  quantity: number,
  fromUnit: string,
  toUnit: string,
  density: number
): number | null {
  const from = getUnit(fromUnit);
  const to = getUnit(toUnit);
  if (!from || !to) return null;

  // volume → weight
  if (from.family === "volume" && to.family === "weight") {
    const ml = quantity * from.toBase;
    const grams = ml * density;
    return grams / to.toBase;
  }

  // weight → volume
  if (from.family === "weight" && to.family === "volume") {
    const grams = quantity * from.toBase;
    const ml = grams / density;
    return ml / to.toBase;
  }

  return null;
}

/** Check if a unit string is recognised */
export function isKnownUnit(unit: string): boolean {
  return normaliseUnit(unit) in UNITS;
}

/** Get the unit family for a unit string */
export function getUnitFamily(unit: string): UnitFamily | null {
  return getUnit(unit)?.family ?? null;
}
