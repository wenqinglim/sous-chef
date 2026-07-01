/**
 * Schema.org JSON-LD recipe extractor.
 *
 * All four primary target sites (RecipeTin Eats, Woks of Life, Hot Thai Kitchen,
 * Made With Lau) expose schema.org Recipe markup. This extractor should fire
 * for ~100% of requests from those sites; the LLM fallback is for everything else.
 *
 * Extraction strategy:
 *   1. Find all <script type="application/ld+json"> blocks in the HTML
 *   2. Parse each JSON block
 *   3. Search for @type === "Recipe" (directly or inside @graph arrays)
 *   4. Extract name, recipeIngredient, recipeYield, recipeInstructions
 */

import * as cheerio from "cheerio";
import type { InstructionStep, Recipe, RecipeIngredient } from "@/types";
import { inferCuisineSource } from "@/lib/normalizers/lookup";
import { v4 as uuidv4 } from "uuid";

// ─── Types ────────────────────────────────────────────────────────────────────

/** recipeInstructions entries: plain strings, HowToStep, or HowToSection */
type SchemaOrgInstruction =
  | string
  | {
      "@type"?: string | string[];
      text?: string;
      name?: string;
      itemListElement?: SchemaOrgInstruction[];
    };

interface SchemaOrgRecipe {
  "@type"?: string | string[];
  name?: string;
  recipeIngredient?: string[];
  recipeYield?: string | string[] | number;
  recipeInstructions?: SchemaOrgInstruction[] | SchemaOrgInstruction;
  url?: string;
}

type LdJson = SchemaOrgRecipe & {
  "@graph"?: SchemaOrgRecipe[];
  "@context"?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Check if an object has @type === "Recipe" (string or array) */
function isRecipeObject(obj: SchemaOrgRecipe): boolean {
  const type = obj["@type"];
  if (!type) return false;
  if (typeof type === "string") return type === "Recipe";
  if (Array.isArray(type)) return type.includes("Recipe");
  return false;
}

/**
 * Parse recipeYield into a positive integer.
 * Handles: "4", "Serves 4", "4-6 servings", "Makes 12 cookies", ["4"], 4
 * Takes the lower bound of a range (conservative).
 * Returns null if no number found.
 */
export function parseServings(raw: string | string[] | number | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;

  // Already a number
  if (typeof raw === "number") {
    return raw > 0 ? Math.round(raw) : null;
  }

  // Array — take first element
  const s = Array.isArray(raw) ? String(raw[0]) : String(raw);

  // Extract first integer in the string (lower bound of a range like "4-6")
  const match = s.match(/(\d+)/);
  if (!match) return null;

  const n = parseInt(match[1], 10);
  return n > 0 ? n : null;
}

/**
 * Decode HTML character references in extracted text.
 *
 * JSON-LD lives inside `<script type="application/ld+json">`, which the HTML
 * spec treats as a *raw text* element — the parser does NOT decode character
 * references inside it. WordPress/WP Recipe Maker (RecipeTin Eats et al.)
 * HTML-escapes apostrophes and ampersands in its JSON-LD, so strings arrive as
 * `chef&#39;s`, `salt &amp; pepper`, `jalape&#241;o`. JSON.parse keeps those
 * five/six characters verbatim and React then renders the literal `&#39;`.
 *
 * Decode the handful of named entities recipe text actually uses, plus every
 * numeric (`&#39;`) and hex (`&#x27;`) reference.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  quot: '"',
  lt: "<",
  gt: ">",
  nbsp: " ",
  deg: "°",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

export function decodeHtmlEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      if (Number.isNaN(code)) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[body];
    return named !== undefined ? named : match;
  });
}

/** Strip HTML tags, decode entities, and collapse whitespace in a step string */
function cleanStepText(s: string): string {
  return decodeHtmlEntities(s.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize a raw recipeIngredient string from JSON-LD.
 *
 * WP Recipe Maker (RecipeTin Eats and many other WordPress recipe sites)
 * renders the ingredient "notes" field by wrapping it in literal `(...)`.
 * When the author's note text itself starts with a comma or contains its own
 * parens, this produces doubled-up artifacts:
 *
 *   "1/4 cup flour ((Note 1))"               → "1/4 cup flour (Note 1)"
 *   "2 garlic cloves (, minced)"             → "2 garlic cloves, minced"
 *   "chicken breast (, boneless (2 pieces))" → "chicken breast, boneless (2 pieces)"
 *
 * Without this, those duplicated brackets leak straight into the recipe
 * detail UI (raw_text is rendered as-is).
 */
export function cleanIngredientText(raw: string): string {
  let s = decodeHtmlEntities(raw);
  let prev: string;
  do {
    prev = s;
    // (, X) → , X  — outer parens wrapping a leading-comma note. Consume any
    // whitespace before the `(` too, so we don't leave a "foo , X" gap.
    // Inner pattern allows one level of nested () so "chicken (, foo (bar))"
    // unwraps cleanly to "chicken, foo (bar)".
    s = s.replace(/\s*\(\s*,\s*([^()]*(?:\([^()]*\)[^()]*)*)\)/g, ", $1");
    // ((X)) → (X) — outer parens redundantly wrapping a parenthesized note.
    s = s.replace(/\(\(([^()]*)\)\)/g, "($1)");
  } while (s !== prev);
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Parse recipeInstructions into an ordered array of steps, preserving section
 * grouping. Handles the three common JSON-LD shapes:
 *   1. Plain string array:  ["Boil water.", "Add pasta."]
 *   2. HowToStep objects:   [{ "@type": "HowToStep", "text": "..." }]
 *   3. HowToSection:        [{ "@type": "HowToSection", "name": "Sauce",
 *                              "itemListElement": [...] }]
 * Plus a single plain string (split on newlines) and a lone unwrapped
 * step/section object (some recipe plugins skip the array). A `HowToSection`'s
 * `name` is attached as the `section` of its nested steps; top-level steps get
 * `section: null`. Returns [] for missing/unparseable input — instructions are
 * optional.
 *
 * @param raw      recipeInstructions value
 * @param section  section label to tag the parsed steps with (set when
 *                 recursing into a HowToSection)
 */
export function parseInstructions(
  raw: SchemaOrgInstruction[] | SchemaOrgInstruction | undefined | null,
  section: string | null = null
): InstructionStep[] {
  if (raw === undefined || raw === null) return [];

  if (typeof raw === "string") {
    return raw
      .split(/\r?\n/)
      .map(cleanStepText)
      .filter((s) => s.length > 0)
      .map((text) => ({ text, section }));
  }

  if (typeof raw !== "object") return [];

  // Lone HowToStep/HowToSection object not wrapped in an array
  const items = Array.isArray(raw) ? raw : [raw];

  const steps: InstructionStep[] = [];
  for (const item of items) {
    if (typeof item === "string") {
      const cleaned = cleanStepText(item);
      if (cleaned) steps.push({ text: cleaned, section });
      continue;
    }
    if (typeof item !== "object" || item === null) continue;

    // HowToSection (or anything with nested steps) — recurse, tagging the
    // nested steps with this section's name.
    if (Array.isArray(item.itemListElement)) {
      const name = typeof item.name === "string" ? item.name.trim() : "";
      steps.push(...parseInstructions(item.itemListElement, name || section));
      continue;
    }

    // HowToStep — prefer text, fall back to name
    const text = item.text ?? item.name;
    if (typeof text === "string") {
      const cleaned = cleanStepText(text);
      if (cleaned) steps.push({ text: cleaned, section });
    }
  }
  return steps;
}

/**
 * Extract ingredient groups from rendered recipe-plugin HTML. JSON-LD's
 * `recipeIngredient` is flat, but the page markup keeps the group headers — we
 * mine those to recover section labels. Handles the two dominant plugins:
 *   - WP Recipe Maker (RecipeTin Eats, Hot Thai Kitchen): a
 *     `.wprm-recipe-ingredient-group` per group, header in
 *     `.wprm-recipe-ingredient-group-name`, items in `.wprm-recipe-ingredient`.
 *   - Tasty Recipes (The Woks of Life): heading tags interleaved with `<ul>`
 *     inside `.tasty-recipes-ingredients-body`.
 * Returns [] when no group markup is found (→ caller leaves ingredients
 * ungrouped). Only groups with at least one item are returned.
 */
export function extractIngredientGroups(
  $: cheerio.CheerioAPI
): Array<{ name: string | null; items: string[] }> {
  const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

  // WP Recipe Maker
  const wprmGroups: Array<{ name: string | null; items: string[] }> = [];
  $(".wprm-recipe-ingredient-group").each((_, groupEl) => {
    const name =
      collapse($(groupEl).find(".wprm-recipe-ingredient-group-name").first().text()) || null;
    const items: string[] = [];
    $(groupEl)
      .find(".wprm-recipe-ingredient")
      .each((__, ingEl) => {
        const text = collapse($(ingEl).text());
        if (text) items.push(text);
      });
    if (items.length > 0) wprmGroups.push({ name, items });
  });
  if (wprmGroups.length > 0) return wprmGroups;

  // Tasty Recipes — walk children in document order, headings open a new group.
  // Scope to the items wrapper (`-body`), not the outer container, so the
  // plugin's own generic "Ingredients" title + scale-button heading don't leak
  // in as a section. Fall back to the outer container for markup variants that
  // lack a `-body` wrapper.
  const tastyBody = $(".tasty-recipes-ingredients-body").first();
  const tastyContainer =
    tastyBody.length > 0 ? tastyBody : $(".tasty-recipes-ingredients").first();
  if (tastyContainer.length > 0) {
    const groups: Array<{ name: string | null; items: string[] }> = [];
    let current: { name: string | null; items: string[] } | null = null;
    tastyContainer
      .find("h2, h3, h4, h5, h6, li")
      .each((_, el) => {
        const tag = (el as { tagName?: string }).tagName?.toLowerCase() ?? "";
        if (tag.startsWith("h")) {
          const name = collapse($(el).text()) || null;
          current = { name, items: [] };
          groups.push(current);
        } else {
          const text = collapse($(el).text());
          if (!text) return;
          if (!current) {
            current = { name: null, items: [] };
            groups.push(current);
          }
          current.items.push(text);
        }
      });
    // Generic plugin titles ("Ingredients", "Method", …) aren't real sub-group
    // labels — null them so a recipe without sub-groups stays ungrouped, while a
    // genuinely grouped recipe with a leaked title keeps only its real groups.
    const cleaned = groups
      .filter((g) => g.items.length > 0)
      .map((g) =>
        g.name && isGenericGroupLabel(g.name) ? { ...g, name: null } : g
      );
    // Only meaningful if at least one group still carries a real label.
    if (cleaned.some((g) => g.name)) return cleaned;
  }

  return [];
}

/** Generic plugin section titles that should not be treated as group labels. */
function isGenericGroupLabel(name: string): boolean {
  return /^(ingredients?|instructions?|directions?|method)$/i.test(name.trim());
}

/**
 * Assign a `section` label to each `recipeIngredient` entry from HTML groups.
 *
 * Resolution order, chosen so a count match alone is never blindly trusted yet
 * the common same-source case still works even when the HTML text is formatted
 * slightly differently from the JSON-LD:
 *   1. Counts equal AND every pair matches by normalized text in order → map by
 *      index (fast; also correct when an ingredient line repeats across groups).
 *   2. Else, if every raw ingredient resolves in the normalized text map (a pure
 *      reorder — text still corresponds) → use the text-matched labels.
 *   3. Else, if counts still equal → fall back to index order (texts differ only
 *      in formatting; index remains the best signal).
 *   4. Else (counts differ, no full text match) → text-match best-effort, null
 *      for anything unmatched.
 *
 * @param rawIngredients  the JSON-LD recipeIngredient strings (pre-clean)
 * @param groups          output of extractIngredientGroups
 * @returns               section label per index (aligned to rawIngredients)
 */
export function assignIngredientSections(
  rawIngredients: string[],
  groups: Array<{ name: string | null; items: string[] }>
): Array<string | null> {
  if (groups.length === 0) return rawIngredients.map(() => null);

  // Flatten the grouped items into a parallel (label, text) sequence.
  const flat: Array<{ name: string | null; text: string }> = [];
  for (const g of groups) {
    for (const text of g.items) flat.push({ name: g.name, text });
  }

  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const sameCount = flat.length === rawIngredients.length;

  // 1. Index alignment, but only when the texts actually line up in order.
  if (sameCount && flat.every((f, i) => norm(f.text) === norm(rawIngredients[i]))) {
    return flat.map((f) => f.name);
  }

  // Normalized text map (first occurrence wins on duplicates).
  const byText = new Map<string, string | null>();
  for (const f of flat) {
    if (!byText.has(norm(f.text))) byText.set(norm(f.text), f.name);
  }

  // 2. Pure reorder: every ingredient corresponds to a grouped item by text.
  if (rawIngredients.every((raw) => byText.has(norm(raw)))) {
    return rawIngredients.map((raw) => byText.get(norm(raw)) ?? null);
  }

  // 3. Same count but text differs (formatting) — trust index order.
  if (sameCount) {
    return flat.map((f) => f.name);
  }

  // 4. Counts differ — best-effort text match, ungrouped otherwise.
  return rawIngredients.map((raw) => byText.get(norm(raw)) ?? null);
}

/**
 * Extract all potential Recipe objects from a parsed LD+JSON value.
 * Handles direct objects and @graph arrays.
 */
function extractRecipeObjects(parsed: LdJson): SchemaOrgRecipe[] {
  const results: SchemaOrgRecipe[] = [];

  if (isRecipeObject(parsed)) {
    results.push(parsed);
  }

  if (Array.isArray(parsed["@graph"])) {
    for (const item of parsed["@graph"]) {
      if (isRecipeObject(item)) {
        results.push(item);
      }
    }
  }

  // Some sites wrap everything in a top-level array
  if (Array.isArray(parsed)) {
    for (const item of parsed as unknown as LdJson[]) {
      if (isRecipeObject(item)) {
        results.push(item);
      }
      if (Array.isArray(item["@graph"])) {
        for (const graphItem of item["@graph"]) {
          if (isRecipeObject(graphItem)) results.push(graphItem);
        }
      }
    }
  }

  return results;
}

// ─── Main extractor ───────────────────────────────────────────────────────────

export interface ExtractionResult {
  recipe: Recipe | null;
  /** Reason for failure — present when recipe is null */
  error?: string;
}

/**
 * Extract recipe data from raw HTML using schema.org JSON-LD markup.
 *
 * @param html  Raw HTML string (full page)
 * @param url   Source URL (used for cuisine detection and stored on Recipe)
 */
export function extractFromSchemaOrg(html: string, url: string): ExtractionResult {
  const $ = cheerio.load(html);
  const ldJsonBlocks: string[] = [];

  // Collect all LD+JSON script blocks
  $('script[type="application/ld+json"]').each((_, el) => {
    const content = $(el).html();
    if (content) ldJsonBlocks.push(content);
  });

  if (ldJsonBlocks.length === 0) {
    return { recipe: null, error: "No JSON-LD blocks found in HTML" };
  }

  // Parse each block and look for Recipe objects
  const recipeObjects: SchemaOrgRecipe[] = [];
  for (const block of ldJsonBlocks) {
    try {
      const parsed = JSON.parse(block) as LdJson;
      const found = extractRecipeObjects(parsed);
      recipeObjects.push(...found);
    } catch {
      // Malformed JSON — skip this block
    }
  }

  if (recipeObjects.length === 0) {
    return { recipe: null, error: "No Recipe objects found in JSON-LD" };
  }

  // Use first Recipe object found
  const schemaRecipe = recipeObjects[0];

  // Validate minimum required fields
  const title = schemaRecipe.name ? decodeHtmlEntities(schemaRecipe.name).trim() : undefined;
  if (!title) {
    return { recipe: null, error: "Recipe name missing from schema.org data" };
  }

  const rawIngredients = schemaRecipe.recipeIngredient;
  if (!rawIngredients || rawIngredients.length === 0) {
    return {
      recipe: null,
      error: "recipeIngredient array missing or empty",
    };
  }

  const baseServings = parseServings(schemaRecipe.recipeYield);
  if (!baseServings) {
    return { recipe: null, error: "Could not parse recipeYield into a number" };
  }

  // Build the Recipe struct
  const recipeId = uuidv4();
  // JSON-LD recipeIngredient is flat; recover section labels from the page's
  // recipe-plugin markup (WPRM / Tasty Recipes) and align by index/text.
  const sections = assignIngredientSections(
    rawIngredients,
    extractIngredientGroups($)
  );
  const ingredients: RecipeIngredient[] = rawIngredients.map((raw, i) => {
    const cleaned = cleanIngredientText(raw);
    return {
      recipe_id: recipeId,
      raw_text: cleaned,
      quantity: null,
      unit: null,
      name: cleaned, // Will be parsed in the normalization step
      canonical_id: null,
      section: sections[i] ?? null,
    };
  });

  const recipe: Recipe = {
    id: recipeId,
    url,
    title,
    base_servings: baseServings,
    parsed_at: new Date().toISOString(),
    cuisine_source: inferCuisineSource(url),
    ingredients,
    // Missing/unparseable instructions never fail extraction
    instructions: parseInstructions(schemaRecipe.recipeInstructions),
  };

  return { recipe };
}

/**
 * Strip <script>, <style>, and other non-content tags from HTML,
 * returning readable text suitable for LLM processing.
 */
export function extractBodyText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, header, footer, nav, aside").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}
