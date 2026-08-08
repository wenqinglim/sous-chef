/**
 * Shared unit-token vocabulary for ingredient text parsing.
 *
 * Lives in its own module (rather than `parser.ts`) so the lower-level
 * `numeric-extract.ts` can reference it when scanning for a quantity that
 * isn't at the start of the string, without creating a circular import
 * (`parser.ts` already imports from `numeric-extract.ts`).
 */

// ─── Known unit tokens (ordered: multi-word first, longest first) ─────────────

export const UNIT_TOKENS = [
  // multi-word — must precede single-word to avoid partial matches
  "fl. oz.",
  "fl. oz",
  "fl oz",
  "fluid ounces",
  "fluid ounce",
  "fluid oz",
  // long single-word
  "tablespoons",
  "tablespoon",
  "teaspoons",
  "teaspoon",
  "milliliters",
  "millilitres",
  "milliliter",
  "millilitre",
  "kilograms",
  "kilogram",
  "milligrams",
  "milligram",
  "gallons",
  "gallon",
  "quarts",
  "quart",
  "pints",
  "pint",
  "ounces",
  "ounce",
  "pounds",
  "pound",
  "liters",
  "litres",
  "liter",
  "litre",
  "grams",
  "gram",
  "bunches",
  "bunch",
  "stalks",
  "stalk",
  "sprigs",
  "sprig",
  "slices",
  "slice",
  "pieces",
  "piece",
  "cloves",
  "clove",
  "sticks",
  "stick",
  "sheets",
  "sheet",
  "heads",
  "head",
  "fillets",
  "fillet",
  "leaves",
  "leaf",
  "stems",
  "stem",
  "inches",
  "inch",
  "knobs",
  "knob",
  "dozens",
  "dozen",
  "cans",
  "can",
  "tins",
  "tin",
  "bottles",
  "bottle",
  "packages",
  "package",
  "packets",
  "packet",
  "bags",
  "bag",
  "blocks",
  "block",
  "whole",
  "each",
  "cups",
  "cup",
  "tbsp.",
  "tbsp",
  "tbs.",
  "tbs",
  "tsp.",
  "tsp",
  "oz.",
  "oz",
  "lbs",
  "lb.",
  "lb",
  "kg",
  "mg",
  "ml",
  "cm",
  "g",
  "l",
];

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Build a single alternation regex for units (longest/multi-word first).
// Exported so other callers (e.g. the Instagram recipe heuristic) match the
// exact unit vocabulary the parser understands instead of duplicating it.
export const UNIT_RE_SOURCE = UNIT_TOKENS.map(escapeRegex).join("|");
