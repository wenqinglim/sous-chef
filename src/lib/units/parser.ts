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
import { UNICODE_FRACTIONS, UF, findQuantityToken } from "./numeric-extract";
import { UNIT_TOKENS, UNIT_RE_SOURCE } from "./unit-vocab";

// Re-exported for existing external consumers (e.g. the Instagram recipe
// heuristic, which matches against the same unit vocabulary this parser
// uses). The vocabulary itself lives in `./unit-vocab` so the lower-level
// `numeric-extract.ts` can also use it without a circular import.
export { UNIT_TOKENS, UNIT_RE_SOURCE };

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

  // Integer + unicode fraction, optional space: "1½" or "1 ½"
  const intUnicode = s.match(new RegExp(`^(\\d+)\\s*([${UF}])$`));
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

  // For "to taste" / "as needed" items the quantity is meaningless, but the
  // line may still carry a leading number ("1-3 chilies to taste") and unit
  // that must be stripped so the name resolves cleanly. Strip the phrase here,
  // then run the normal number/unit extraction below and null the quantity.
  if (isToTaste) {
    text = text
      .replace(/\bto taste\b|\bas needed\b|\bto serve\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // 5. Locate the quantity token — usually leading ("2 tbsp flour"), but a
  // fallback scan also finds it mid-string for name-first lines
  // ("Soy sauce, 2 tbsp"). See findQuantityToken in numeric-extract.ts.
  const match = findQuantityToken(text);
  let quantity: number | null = null;
  let unit: string | null = null;
  let rest = text;

  if (match !== null) {
    quantity = match.hi != null ? (match.lo + match.hi) / 2 : match.lo;
    const unitRe = new RegExp(`^(${UNIT_RE_SOURCE})\\b`, "i");

    if (match.index === 0) {
      // Leading quantity: consume the number, then look for a unit
      // immediately after it.
      rest = text.slice(match.consumed).trim();
      const unitMatch = rest.match(unitRe);
      if (unitMatch) {
        unit = unitMatch[1].toLowerCase().trim();
        rest = rest.slice(unitMatch[1].length).trim();
      }
    } else {
      // Non-leading match: the fallback scan already anchored on an
      // adjacent unit (up to `unitEnd`), so splice both the number and the
      // unit out and treat what's left as the name.
      const afterNumber = text.slice(match.index + match.consumed, match.unitEnd).trim();
      const unitMatch = afterNumber.match(unitRe);
      unit = unitMatch ? unitMatch[1].toLowerCase().trim() : null;
      rest = (
        text.slice(0, match.index) + text.slice(match.unitEnd ?? match.index + match.consumed)
      ).trim();
    }
    // Normalise "T" (capital tablespoon shorthand)
    if (unit === "t") unit = "tbsp";
  }

  // 6. Clean the ingredient name
  const name = cleanName(rest);

  // "to taste" / "as needed" → quantity is not meaningful
  return { quantity: isToTaste ? null : quantity, unit, name };
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
