/**
 * Recipe repository — the only module that touches `prisma.recipe`.
 *
 * Multi-user support later means adding a userId param/filter here (and a
 * migration changing the url unique constraint to @@unique([url, userId]));
 * no other module needs to change.
 */

import type { Prisma, Recipe as RecipeRow } from "@prisma/client";
import type { CuisineSource, Recipe, RecipeIngredient } from "@/types";
import { prisma } from "./client";

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

/**
 * Normalize a URL for dedupe: drop hash, tracking params, and trailing slash
 * so https://x.com/recipe/ and https://x.com/recipe?utm_source=y collapse
 * into one library entry.
 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_cid|mc_eid|ref$)/i.test(key)) {
        u.searchParams.delete(key);
      }
    }
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString();
  } catch {
    return url;
  }
}

function toRowData(recipe: Recipe, url: string) {
  return {
    url,
    title: recipe.title,
    baseServings: recipe.base_servings,
    cuisineSource: recipe.cuisine_source,
    ingredients: recipe.ingredients as unknown as Prisma.InputJsonValue,
    instructions: recipe.instructions as unknown as Prisma.InputJsonValue,
    parsedAt: new Date(recipe.parsed_at),
  };
}

// ─── Repository functions ─────────────────────────────────────────────────────

export async function listRecipes(): Promise<RecipeSummary[]> {
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
  } catch {
    // P2025 — record not found
    return false;
  }
}
