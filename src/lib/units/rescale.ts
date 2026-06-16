/**
 * Rescale a raw ingredient line by a scalar.
 *
 * Multiplies the leading numeric token in `rawText` by `scaleFactor` and
 * substitutes it back, preserving the unit, ingredient name, and any
 * prep/parenthetical text that follows.
 *
 * Handles every numeric form the extractor produces:
 *   - integer ("2 cups flour")
 *   - decimal ("1.5 lb chicken")
 *   - plain fraction ("1/4 tsp salt")
 *   - mixed ("1 1/2 cups water")
 *   - integer + unicode fraction ("1½ cups milk", "1 ½ cups milk")
 *   - bare unicode fraction ("½ tsp pepper")
 *   - range ("3-4 cloves garlic", "3 to 4 cloves")
 *
 * If the line has no parseable leading quantity (e.g. "salt to taste") or the
 * scale factor is 1 / non-finite / non-positive, the original text is returned
 * unchanged. The scaled value is rendered as a mixed-number with unicode
 * fractions when it lands close to a common cooking fraction (¼, ⅓, ½, ⅔, ¾,
 * etc.), or as a trimmed decimal otherwise.
 */

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

const UF = Object.keys(UNICODE_FRACTIONS).join("");

interface Extracted {
  /** Effective numeric value(s). For ranges, both endpoints are present. */
  lo: number;
  hi: number | null;
  /** Number of leading characters of the source consumed by this token. */
  consumed: number;
}

function parseNumberToken(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  if (t in UNICODE_FRACTIONS) return UNICODE_FRACTIONS[t];

  // "N frac" (space) or "Nfrac" (no space)
  const intUnicode = t.match(new RegExp(`^(\\d+)\\s*([${UF}])$`));
  if (intUnicode) return parseInt(intUnicode[1], 10) + UNICODE_FRACTIONS[intUnicode[2]];

  const mixed = t.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const den = parseInt(mixed[3], 10);
    if (den === 0) return null;
    return parseInt(mixed[1], 10) + parseInt(mixed[2], 10) / den;
  }

  const frac = t.match(/^(\d+)\/(\d+)$/);
  if (frac) {
    const den = parseInt(frac[2], 10);
    if (den === 0) return null;
    return parseInt(frac[1], 10) / den;
  }

  const decimal = t.match(/^\d+[.,]\d+$/);
  if (decimal) return parseFloat(t.replace(",", "."));

  if (/^\d+$/.test(t)) return parseInt(t, 10);

  return null;
}

const NUM = `(?:\\d+\\s+\\d+\\/\\d+|\\d+\\s*[${UF}]|[${UF}]|\\d+\\/\\d+|\\d+(?:[.,]\\d+)?)`;
const RANGE_RE = new RegExp(`^(${NUM})\\s*(?:-|–|—|to)\\s*(${NUM})`);
const SINGLE_RE = new RegExp(`^(${NUM})`);

function extractLeading(s: string): Extracted | null {
  // Range first so e.g. "3-4" isn't truncated to "3".
  const rm = s.match(RANGE_RE);
  if (rm) {
    const lo = parseNumberToken(rm[1]);
    const hi = parseNumberToken(rm[2]);
    if (lo != null && hi != null) return { lo, hi, consumed: rm[0].length };
  }
  const sm = s.match(SINGLE_RE);
  if (sm) {
    const v = parseNumberToken(sm[1]);
    if (v != null) return { lo: v, hi: null, consumed: sm[0].length };
  }
  return null;
}

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

  // Decimal fallback: 2 decimals for small values, integer for larger.
  if (n >= 10) return String(Math.round(n));
  return String(Math.round(n * 100) / 100);
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

  const extracted = extractLeading(rawText);
  if (!extracted) return rawText;

  const tail = rawText.slice(extracted.consumed);
  if (extracted.hi != null) {
    const lo = formatScaledQty(extracted.lo * scaleFactor);
    const hi = formatScaledQty(extracted.hi * scaleFactor);
    return `${lo}-${hi}${tail}`;
  }
  const v = formatScaledQty(extracted.lo * scaleFactor);
  return `${v}${tail}`;
}
