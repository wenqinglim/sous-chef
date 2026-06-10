/**
 * Recipe repository — the only module that touches `prisma.recipe`.
 *
 * Multi-user support later means adding a userId param/filter here (and a
 * migration changing the url unique constraint to @@unique([url, userId]));
 * no other module needs to change.
 */

import { Prisma } from "@prisma/client";
import type { Recipe as RecipeRow } from "@prisma/client";
import type { CuisineSource, Recipe, RecipeIngredient } from "@/types";
import { normalizeUrl } from "@/lib/normalize-url";
import { prisma } from "./client";

export { normalizeUrl };

// ─── Summaries (library list) ─────────────────────────────────────────────────

export interface RecipeSummary {
  id: string;
  url: string;
  title: string;
  base_servings: number;
  ingredient_count: number;
  has_instructions: boolean;
  created_at: string;
}

// ─── Pure mappers (exported for tests; no DB access) ─────────────────────────

const CUISINE_SOURCES: CuisineSource[] = ["asian", "western", "unknown"];

/**
 * Map a DB row to the app's Recipe document. Tolerant reads: JSONB payloads
 * from older schema versions get defaults instead of crashing (same
 * philosophy as readVersioned in the localStorage helpers).
 */
export function rowToRecipe(row: RecipeRow): Recipe {
  const cuisine = CUISINE_SOURCES.includes(row.cuisineSource as CuisineSource)
    ? (row.cuisineSource as CuisineSource)
    : "unknown";
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    base_servings: row.baseServings,
    parsed_at: row.parsedAt.toISOString(),
    cuisine_source: cuisine,
    ingredients: Array.isArray(row.ingredients)
      ? (row.ingredients as unknown as RecipeIngredient[])
      : [],
    instructions: Array.isArray(row.instructions)
      ? (row.instructions as unknown as string[])
      : [],
  };
}

/**
 * Rewrite the embedded recipe_id on every ingredient. Used when an upsert
 * keeps the existing DB row's id instead of the freshly extracted one.
 */
export function withRecipeId(recipe: Recipe, id: string): Recipe {
  return {
    ...recipe,
    id,
    ingredients: recipe.ingredients.map((ing) => ({ ...ing, recipe_id: id })),
  };
}

function toRowData(recipe: Recipe, url: string) {
  return {
    url,
    title: recipe.title,
    baseServings: recipe.base_servings,
    cuisineSource: recipe.cuisine_source,
    // Columns are NOT NULL — default rather than fail on a partial Recipe
    ingredients: (recipe.ingredients ?? []) as unknown as Prisma.InputJsonValue,
    instructions: (recipe.instructions ?? []) as unknown as Prisma.InputJsonValue,
    parsedAt: new Date(recipe.parsed_at),
  };
}

// ─── Repository functions ─────────────────────────────────────────────────────

export async function listRecipes(): Promise<RecipeSummary[]> {
  // Fetches whole rows (incl. JSONB) to compute the counts — Prisma can't
  // take jsonb_array_length without raw SQL. Fine at personal-library scale;
  // revisit with $queryRaw if libraries grow into the hundreds.
  const rows = await prisma.recipe.findMany({
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => ({
    id: row.id,
    url: row.url,
    title: row.title,
    base_servings: row.baseServings,
    ingredient_count: Array.isArray(row.ingredients)
      ? row.ingredients.length
      : 0,
    has_instructions:
      Array.isArray(row.instructions) && row.instructions.length > 0,
    created_at: row.createdAt.toISOString(),
  }));
}

export async function getRecipe(id: string): Promise<Recipe | null> {
  const row = await prisma.recipe.findUnique({ where: { id } });
  return row ? rowToRecipe(row) : null;
}

/**
 * Save a freshly extracted recipe, deduping by normalized URL.
 *
 * On URL conflict the existing row's id wins (no id churn on re-extract) and
 * the stored document is replaced wholesale — manual edits only ever live in
 * the review step, never in the DB, so nothing user-authored is lost.
 * Returns the recipe as stored, with ingredient recipe_ids rewritten to the
 * surviving id.
 */
export async function upsertRecipeByUrl(recipe: Recipe): Promise<Recipe> {
  const url = normalizeUrl(recipe.url);
  const existing = await prisma.recipe.findUnique({ where: { url } });
  const id = existing?.id ?? recipe.id;
  const stored = withRecipeId({ ...recipe, url }, id);
  const data = toRowData(stored, url);

  const row = await prisma.recipe.upsert({
    where: { url },
    create: { id, ...data },
    update: data,
  });
  return rowToRecipe(row);
}

export async function deleteRecipe(id: string): Promise<boolean> {
  try {
    await prisma.recipe.delete({ where: { id } });
    return true;
  } catch (err) {
    // P2025 = record not found → false; anything else (connection errors,
    // timeouts) must propagate so the route returns 500, not a bogus 404
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2025"
    ) {
      return false;
    }
    throw err;
  }
}
