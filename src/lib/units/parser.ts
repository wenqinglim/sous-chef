/**
 * Ingredient text parser.
 *
 * Parses strings like:
 *   "2 1/2 cups fish sauce"
 *   "½ tsp white pepper"
 *   "3-4 stalks lemongrass, bruised"
 *   "1 tbsp oyster sauce (or hoisin sauce)"
 *   "salt to taste"
 *
 * Returns { quantity, unit, name } where name is the ingredient name stripped
 * of quantity, unit, and preparation notes.
 */

import type { ParsedQuantity } from "@/types";

// ─── Unicode fraction map ─────────────────────────────────────────────────────

const UNICODE_FRACTIONS: Record<string, number> = {
  "½": 0.5,
  "¼": 0.25,
  "¾": 0.75,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅕": 0.2,
  "⅖": 0.4,
  "⅗": 0.6,
  "⅘": 0.8,
  "⅙": 1 / 6,
  "⅚": 5 / 6,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
};

// Unicode fraction chars as a string (for character classes)
const UF = Object.keys(UNICODE_FRACTIONS).join("");

// ─── Known unit tokens (ordered: multi-word first, longest first) ─────────────

const UNIT_TOKENS = [
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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Build a single alternation regex for units (longest/multi-word first)
const UNIT_RE_SOURCE = UNIT_TOKENS.map(escapeRegex).join("|");

// ─── Number parsing ───────────────────────────────────────────────────────────

/**
 * Parse a number token. Handles:
 *   - Plain integer: "3"
 *   - Decimal: "1.5"
 *   - Plain fraction: "1/4"
 *   - Mixed number: "2 1/2"
 *   - Unicode fraction alone: "½"
 *   - Integer + unicode fraction: "1½"
 */
export function parseNumber(token: string): number | null {
  const s = token.trim();
  if (!s) return null;

  // Unicode fraction alone (single char)
  if (s in UNICODE_FRACTIONS) return UNICODE_FRACTIONS[s];

  // Integer + unicode fraction: "1½"
  const intUnicode = s.match(new RegExp(`^(\\d+)([${UF}])$`));
  if (intUnicode) {
    const frac = UNICODE_FRACTIONS[intUnicode[2]];
    if (frac !== undefined) return parseInt(intUnicode[1], 10) + frac;
  }

  // Mixed number with space: "2 1/2"
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const whole = parseInt(mixed[1], 10);
    const num = parseInt(mixed[2], 10);
    const den = parseInt(mixed[3], 10);
    if (den === 0) return null;
    return whole + num / den;
  }

  // Plain fraction: "1/4"
  const fraction = s.match(/^(\d+)\/(\d+)$/);
  if (fraction) {
    const den = parseInt(fraction[2], 10);
    if (den === 0) return null;
    return parseInt(fraction[1], 10) / den;
  }

  // Decimal: "1.5" or "1,5"
  const decimal = s.match(/^(\d+)[.,](\d+)$/);
  if (decimal) return parseFloat(s.replace(",", "."));

  // Plain integer: "3"
  const integer = s.match(/^\d+$/);
  if (integer) return parseInt(s, 10);

  return null;
}

// ─── Leading number extraction ────────────────────────────────────────────────

/**
 * Try to extract a leading quantity from the start of a string.
 * Returns { quantity, consumed } where consumed is the number of chars consumed,
 * or null if no leading number found.
 *
 * Order of attempts (most specific → least specific):
 *   1. Range:                 "3-4" | "3 to 4" | "3–4"
 *   2. Mixed number:          "2 1/2"
 *   3. Integer + unicode:     "1½"
 *   4. Plain fraction:        "1/4"
 *   5. Unicode fraction:      "½"
 *   6. Decimal / integer:     "1.5" | "3"
 */
function extractLeadingNumber(
  s: string
): { quantity: number; consumed: number } | null {
  // 1. Range: number + separator + number
  //    We need to try this carefully — we'll check if what follows the first
  //    number is a range separator followed by another number.
  const rangeMatch = tryRange(s);
  if (rangeMatch) return rangeMatch;

  // 2. Mixed number: digit(s) + whitespace + digit(s)/digit(s)
  const mixed = s.match(/^(\d+\s+\d+\/\d+)/);
  if (mixed) {
    const qty = parseNumber(mixed[1]);
    if (qty !== null) return { quantity: qty, consumed: mixed[1].length };
  }

  // 2b. Integer + space + unicode fraction: "2 ½"
  const spaceUnicode = s.match(new RegExp(`^(\\d+)\\s+([${UF}])(?=\\s|$)`));
  if (spaceUnicode) {
    const frac = UNICODE_FRACTIONS[spaceUnicode[2]];
    if (frac !== undefined) {
      const qty = parseInt(spaceUnicode[1], 10) + frac;
      return { quantity: qty, consumed: spaceUnicode[0].length };
    }
  }

  // 3. Integer + unicode fraction (no space): "1½"
  const intUnicode = s.match(new RegExp(`^(\\d+[${UF}])`));
  if (intUnicode) {
    const qty = parseNumber(intUnicode[1]);
    if (qty !== null) return { quantity: qty, consumed: intUnicode[1].length };
  }

  // 4. Plain fraction: "1/4"
  const fraction = s.match(/^(\d+\/\d+)/);
  if (fraction) {
    const qty = parseNumber(fraction[1]);
    if (qty !== null) return { quantity: qty, consumed: fraction[1].length };
  }

  // 5. Unicode fraction alone
  if (s.length > 0 && s[0] in UNICODE_FRACTIONS) {
    return { quantity: UNICODE_FRACTIONS[s[0]], consumed: 1 };
  }

  // 6. Decimal or integer
  const num = s.match(/^(\d+(?:[.,]\d+)?)/);
  if (num) {
    const qty = parseNumber(num[1]);
    if (qty !== null) return { quantity: qty, consumed: num[1].length };
  }

  return null;
}

/**
 * Try to parse a range like "3-4" or "3 to 4" from the start of s.
 * Returns midpoint as quantity, or null if no range.
 */
function tryRange(s: string): { quantity: number; consumed: number } | null {
  // Pattern: number + optional_space + separator + optional_space + number
  // The separator is -, –, —, or "to"
  const rangeRe =
    /^(\d+(?:[.,]\d+)?|\d+\/\d+|\d+\s+\d+\/\d+)\s*(?:-|–|—|to)\s*(\d+(?:[.,]\d+)?|\d+\/\d+)/;
  const m = s.match(rangeRe);
  if (!m) return null;

  const lo = parseNumber(m[1]);
  const hi = parseNumber(m[2]);
  if (lo === null || hi === null) return null;

  return { quantity: (lo + hi) / 2, consumed: m[0].length };
}

// ─── Cleaning patterns ────────────────────────────────────────────────────────

/** Matches (or something), (alternatively ...) etc. */
const SUBSTITUTION_RE =
  /\s*\(\s*(?:or|alternatively|can substitute|can use|sub)[^)]*\)/gi;

/** Matches parens containing any non-ASCII character (native script) */
const NATIVE_SCRIPT_RE = /\s*\([^)]*[^\x00-\x7F][^)]*\)/g;

/** Prep notes that don't affect ingredient identity */
const PREP_NOTE_RE =
  /,\s*(?:finely |coarsely |roughly |thinly |freshly |lightly |well )?(?:chopped|sliced|diced|minced|grated|peeled|trimmed|washed|dried|crushed|bruised|toasted|roasted|ground|halved|quartered|deseeded|seeded|cored|shredded|torn|julienned|divided|separated|at room temperature|room temperature|optional|to taste|for serving|for garnish|plus more|as needed)[^,]*/gi;

/** "to taste", "as needed" at end of string */
const TO_TASTE_RE = /\bto taste\b|\bas needed\b|\bto serve\b/i;

// ─── Main parser ──────────────────────────────────────────────────────────────

/**
 * Parse a raw ingredient line into { quantity, unit, name }.
 *
 * The name is cleaned: native-script parens, substitution alternatives,
 * and common prep notes are stripped.
 */
export function parseIngredient(rawText: string): ParsedQuantity {
  let text = rawText.trim();

  // 1. Detect "to taste" / "as needed" early — these always mean null quantity
  const isToTaste = TO_TASTE_RE.test(text);

  // 2. Strip native-script parentheticals first (Thai, Chinese, Korean)
  text = text.replace(NATIVE_SCRIPT_RE, "");

  // 3. Strip substitution alternatives
  text = text.replace(SUBSTITUTION_RE, "");

  // 4. Normalise whitespace
  text = text.replace(/\s+/g, " ").trim();

  if (isToTaste) {
    // Strip the "to taste" phrase, clean the rest as the name
    const nameRaw = text
      .replace(/\bto taste\b|\bas needed\b|\bto serve\b/gi, "")
      .trim();
    return { quantity: null, unit: null, name: cleanName(nameRaw) };
  }

  // 5. Try to extract a leading number
  const numResult = extractLeadingNumber(text);
  let quantity: number | null = null;
  let rest = text;

  if (numResult !== null) {
    quantity = numResult.quantity;
    rest = text.slice(numResult.consumed).trim();
  }

  // 6. Try to match a unit at the start of `rest`
  let unit: string | null = null;
  const unitRe = new RegExp(`^(${UNIT_RE_SOURCE})\\b`, "i");
  const unitMatch = rest.match(unitRe);
  if (unitMatch) {
    unit = unitMatch[1].toLowerCase().trim();
    rest = rest.slice(unitMatch[1].length).trim();
    // Normalise "T" (capital tablespoon shorthand)
    if (unit === "t") unit = "tbsp";
  }

  // 7. Clean the ingredient name
  const name = cleanName(rest);

  return { quantity, unit, name };
}

/**
 * Clean a raw ingredient name string:
 * - Strip prep notes after comma
 * - Strip any remaining parenthetical content
 * - Lowercase and trim
 */
export function cleanName(raw: string): string {
  let s = raw;

  // Strip prep notes after comma (specific patterns first)
  s = s.replace(PREP_NOTE_RE, "");

  // Strip parenthetical content BEFORE comma-truncation so that a comma
  // inside parens (e.g. "bone-in, skin-on") doesn't leave a dangling "("
  s = s.replace(/\s*\([^)]*\)/g, "");

  // Strip any remaining content after a comma — in recipes, commas
  // almost always separate the ingredient name from prep context
  s = s.replace(/,.*$/, "");

  // Strip trailing punctuation (including dangling close-paren)
  s = s.replace(/[,;.–—\-\)]+$/, "");

  return s.trim().toLowerCase();
}
