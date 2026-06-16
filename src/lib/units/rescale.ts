/**
 * Rescale a raw ingredient line by a scalar.
 *
 * Multiplies the leading numeric token in `rawText` by `scaleFactor` and
 * substitutes it back, preserving the unit, ingredient name, and any
 * prep/parenthetical text that follows.
 *
 * Accepts every numeric form `extractLeadingNumeric` recognizes (integer,
 * decimal, plain/mixed fractions, unicode fractions, integer + unicode
 * fraction with or without space, ranges).
 *
 * Parenthetical metric equivalents:
 *   For lines shaped like `N <unit> (M <unit>) <name>` (the common
 *   "1 cup (240 ml) milk" extractor output), the parenthetical quantity is
 *   scaled in lockstep with the leading number so the equivalence stays
 *   valid. Bare-number leading qty followed by parens — e.g.
 *   "1 (15 oz) can chickpeas" — is left untouched in the parens (the parens
 *   describes a package size, not an equivalent).
 *
 * Limitations: other embedded numbers (e.g. "200 g flour, plus 1 tbsp for
 * dusting") are NOT scaled. We don't have enough signal to tell a quantity
 * from a label (think "1 (15 oz) can" or "10 minutes"), and silently scaling
 * the wrong token would be worse than leaving the line alone.
 *
 * If the scale factor is 1 / non-finite / non-positive, or the line has no
 * parseable leading quantity ("salt to taste"), the original text is returned
 * unchanged. The scaled value is rendered as a mixed number with unicode
 * fractions when it lands close to a common cooking fraction (¼, ⅓, ½, ⅔, ¾,
 * …), or as a trimmed decimal otherwise.
 */

import { extractLeadingNumeric } from "./numeric-extract";

const FRACTION_GLYPHS: Array<[number, string]> = [
  [1 / 8, "⅛"],
  [1 / 4, "¼"],
  [1 / 3, "⅓"],
  [3 / 8, "⅜"],
  [1 / 2, "½"],
  [5 / 8, "⅝"],
  [2 / 3, "⅔"],
  [3 / 4, "¾"],
  [7 / 8, "⅞"],
];

/**
 * Render a positive number in a recipe-friendly format: prefer
 * integer-and-unicode-fraction when the fractional part is close to a common
 * cooking fraction; otherwise a trimmed decimal.
 */
export function formatScaledQty(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";

  // Snap to an exact integer if we're within 1% of one.
  const nearestInt = Math.round(n);
  if (Math.abs(n - nearestInt) < 0.01 && nearestInt > 0) return String(nearestInt);

  // For large values, fractional precision is noise — just round to integer.
  if (n >= 10) return String(Math.round(n));

  const whole = Math.floor(n);
  const frac = n - whole;
  const TOL = 0.04;

  // Round-up case: frac is so close to 1 that we'd write "Nx" with no glyph.
  if (1 - frac < TOL) {
    return String(whole + 1);
  }

  let bestGlyph: string | null = null;
  let bestDiff = Infinity;
  for (const [val, glyph] of FRACTION_GLYPHS) {
    const diff = Math.abs(frac - val);
    if (diff < bestDiff && diff < TOL) {
      bestDiff = diff;
      bestGlyph = glyph;
    }
  }

  if (bestGlyph) {
    if (whole === 0) return bestGlyph;
    return `${whole}${bestGlyph}`;
  }

  // Decimal fallback for sub-10 values that didn't snap to a fraction glyph.
  return String(Math.round(n * 100) / 100);
}

/**
 * Match a parenthetical unit equivalent immediately following a unit token,
 * e.g. in "1 cup (240 ml) milk" the substring " cup (240 ml)". The leading
 * \s+\S+ matches the unit (cup/tbsp/g/oz/…); the inner number-unit pair is
 * what we scale.
 */
const PAREN_EQUIVALENT_RE =
  /^(\s+[^\s()]+\s*\()([0-9.,/¼½¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞\s]+?)(\s*[a-zA-Z]+\s*\))/;

function scaleParentheticalEquivalent(
  tail: string,
  scaleFactor: number
): string {
  const m = tail.match(PAREN_EQUIVALENT_RE);
  if (!m) return tail;
  const innerNumber = m[2].trim();
  const parsed = extractLeadingNumeric(innerNumber);
  if (!parsed || parsed.consumed !== innerNumber.length) return tail;
  const scaled = formatScaledQty(parsed.lo * scaleFactor);
  const replacement = `${m[1]}${scaled}${m[3]}`;
  return replacement + tail.slice(m[0].length);
}

export function rescaleIngredientLine(rawText: string, scaleFactor: number): string {
  if (
    !Number.isFinite(scaleFactor) ||
    scaleFactor <= 0 ||
    scaleFactor === 1 ||
    !rawText
  ) {
    return rawText;
  }

  const extracted = extractLeadingNumeric(rawText);
  if (!extracted) return rawText;

  const tail = rawText.slice(extracted.consumed);
  const scaledTail = scaleParentheticalEquivalent(tail, scaleFactor);

  if (extracted.hi != null) {
    const lo = formatScaledQty(extracted.lo * scaleFactor);
    const hi = formatScaledQty(extracted.hi * scaleFactor);
    return `${lo}-${hi}${scaledTail}`;
  }
  const v = formatScaledQty(extracted.lo * scaleFactor);
  return `${v}${scaledTail}`;
}
