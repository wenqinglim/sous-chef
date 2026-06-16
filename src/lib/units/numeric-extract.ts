/**
 * Shared leading-number extractor for ingredient text.
 *
 * Both `parser.ts` (which reduces a range to its midpoint for downstream math)
 * and `rescale.ts` (which keeps both endpoints so a scaled range can be
 * rendered back as "lo-hi") need the same set of numeric forms recognized at
 * the start of a line: integer, decimal, plain/mixed fractions, unicode
 * fractions, integer + unicode fraction (with or without space), and ranges.
 *
 * Keep this module the single source of truth for those forms — when one
 * surface (extraction, rescaling) learns to handle a new form, the other
 * should pick it up automatically.
 */

export const UNICODE_FRACTIONS: Record<string, number> = {
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

/** Unicode fraction characters as a string, for use in character classes. */
export const UF = Object.keys(UNICODE_FRACTIONS).join("");

/**
 * Parse a single complete number token (no leading whitespace, no trailing
 * non-numeric chars). Returns null if the token isn't a recognized form.
 */
export function parseNumberToken(token: string): number | null {
  const s = token.trim();
  if (!s) return null;

  if (s in UNICODE_FRACTIONS) return UNICODE_FRACTIONS[s];

  // Integer + unicode fraction, with optional space ("1½" or "1 ½")
  const intUnicode = s.match(new RegExp(`^(\\d+)\\s*([${UF}])$`));
  if (intUnicode) {
    const frac = UNICODE_FRACTIONS[intUnicode[2]];
    if (frac !== undefined) return parseInt(intUnicode[1], 10) + frac;
  }

  // Mixed number with space ("2 1/2")
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const den = parseInt(mixed[3], 10);
    if (den === 0) return null;
    return parseInt(mixed[1], 10) + parseInt(mixed[2], 10) / den;
  }

  // Plain fraction ("1/4")
  const fraction = s.match(/^(\d+)\/(\d+)$/);
  if (fraction) {
    const den = parseInt(fraction[2], 10);
    if (den === 0) return null;
    return parseInt(fraction[1], 10) / den;
  }

  // Decimal ("1.5" or "1,5")
  const decimal = s.match(/^(\d+)[.,](\d+)$/);
  if (decimal) return parseFloat(s.replace(",", "."));

  // Plain integer ("3")
  if (/^\d+$/.test(s)) return parseInt(s, 10);

  return null;
}

/**
 * A single numeric endpoint in source form (used to build the leading-number
 * and range regexes). Ordered specific → general so e.g. "1 ½" isn't
 * truncated to "1".
 */
const NUM = `(?:\\d+\\s+\\d+\\/\\d+|\\d+\\s*[${UF}]|[${UF}]|\\d+\\/\\d+|\\d+(?:[.,]\\d+)?)`;
const RANGE_RE = new RegExp(`^(${NUM})\\s*(?:-|–|—|to)\\s*(${NUM})`);
const SINGLE_RE = new RegExp(`^(${NUM})`);

export interface ExtractedNumeric {
  /** Lower endpoint (or single value when `hi` is null). */
  lo: number;
  /** Upper endpoint if the leading token was a range, otherwise null. */
  hi: number | null;
  /** Characters of the source consumed by the matched numeric token. */
  consumed: number;
}

/**
 * Match the leading numeric token at the start of `s`.
 *
 * Returns both range endpoints for "A-B" / "A to B" so callers can choose
 * whether to take the midpoint (parser pipeline) or preserve the range
 * (rescaler). Returns null when no recognizable numeric prefix is present —
 * e.g. "salt to taste".
 */
export function extractLeadingNumeric(s: string): ExtractedNumeric | null {
  // Range first so "3-4" isn't truncated to "3".
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
