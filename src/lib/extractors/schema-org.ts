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
import type { Recipe, RecipeIngredient } from "@/types";
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

/** Strip HTML tags and collapse whitespace in a step string */
function cleanStepText(s: string): string {
  return s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
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
  let s = raw;
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
 * Parse recipeInstructions into a flat array of step strings.
 * Handles the three common JSON-LD shapes:
 *   1. Plain string array:  ["Boil water.", "Add pasta."]
 *   2. HowToStep objects:   [{ "@type": "HowToStep", "text": "..." }]
 *   3. HowToSection:        [{ "@type": "HowToSection", "itemListElement": [...] }]
 * Plus a single plain string (split on newlines) and a lone unwrapped
 * step/section object (some recipe plugins skip the array). Sections are
 * flattened. Returns [] for missing/unparseable input — instructions are
 * optional.
 */
export function parseInstructions(
  raw: SchemaOrgInstruction[] | SchemaOrgInstruction | undefined | null
): string[] {
  if (raw === undefined || raw === null) return [];

  if (typeof raw === "string") {
    return raw
      .split(/\r?\n/)
      .map(cleanStepText)
      .filter((s) => s.length > 0);
  }

  if (typeof raw !== "object") return [];

  // Lone HowToStep/HowToSection object not wrapped in an array
  const items = Array.isArray(raw) ? raw : [raw];

  const steps: string[] = [];
  for (const item of items) {
    if (typeof item === "string") {
      const cleaned = cleanStepText(item);
      if (cleaned) steps.push(cleaned);
      continue;
    }
    if (typeof item !== "object" || item === null) continue;

    // HowToSection (or anything with nested steps) — recurse and flatten
    if (Array.isArray(item.itemListElement)) {
      steps.push(...parseInstructions(item.itemListElement));
      continue;
    }

    // HowToStep — prefer text, fall back to name
    const text = item.text ?? item.name;
    if (typeof text === "string") {
      const cleaned = cleanStepText(text);
      if (cleaned) steps.push(cleaned);
    }
  }
  return steps;
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
  const title = schemaRecipe.name?.trim();
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
  const ingredients: RecipeIngredient[] = rawIngredients.map((raw) => {
    const cleaned = cleanIngredientText(raw);
    return {
      recipe_id: recipeId,
      raw_text: cleaned,
      quantity: null,
      unit: null,
      name: cleaned, // Will be parsed in the normalization step
      canonical_id: null,
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
