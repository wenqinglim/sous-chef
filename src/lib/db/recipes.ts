/**
 * Recipe repository — the only module that touches `prisma.recipe`.
 *
 * Multi-user support later means adding a userId param/filter here (and a
 * migration changing the url unique constraint to @@unique([url, userId]));
 * no other module needs to change.
 */

import { Prisma } from "@prisma/client";
import type { Recipe as RecipeRow } from "@prisma/client";
import type {
  CuisineSource,
  InstructionStep,
  Recipe,
  RecipeIngredient,
  RecipeStatus,
} from "@/types";
import { normalizeUrl } from "@/lib/normalize-url";
import { normalizeInstructions } from "@/lib/recipe/sections";
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
  /** True once a user has saved a manual edit (drives the "Customized" badge) */
  edited: boolean;
  /** True when the recipe has non-empty user notes */
  has_notes: boolean;
  /** Curation status; non-admin list requests only ever see "tried_and_tested" */
  status: RecipeStatus;
  /** Freeform curation tags, e.g. "curry", "weeknight" */
  tags: string[];
  created_at: string;
}

// ─── Pure mappers (exported for tests; no DB access) ─────────────────────────

const CUISINE_SOURCES: CuisineSource[] = ["asian", "western", "unknown"];

/** Tolerant status read: rows predating the column (or with garbage) fail closed. */
function rowStatus(status: unknown): RecipeStatus {
  return status === "tried_and_tested" ? "tried_and_tested" : "saved_for_later";
}

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
    // Coerce legacy string[] instructions into InstructionStep[].
    instructions: normalizeInstructions(row.instructions),
    notes: row.notes ?? null,
    edited: row.edited ?? false,
    status: rowStatus(row.status),
    tags: Array.isArray(row.tags) ? row.tags : [],
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

// Deliberately excludes curation metadata (notes, edited, status, tags): a
// re-extract upsert must never clobber those, and creates take the DB defaults.
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

export async function listRecipes(
  options: { includeUntried?: boolean } = {}
): Promise<RecipeSummary[]> {
  // Fetches whole rows (incl. JSONB) to compute the counts — Prisma can't
  // take jsonb_array_length without raw SQL. Fine at personal-library scale;
  // revisit with $queryRaw if libraries grow into the hundreds.
  //
  // includeUntried defaults to false (fail closed): public callers only ever
  // see tried_and_tested recipes; the route opts in for admins.
  const rows = await prisma.recipe.findMany({
    where: options.includeUntried ? undefined : { status: "tried_and_tested" },
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
    edited: row.edited ?? false,
    has_notes: typeof row.notes === "string" && row.notes.trim().length > 0,
    status: rowStatus(row.status),
    tags: Array.isArray(row.tags) ? row.tags : [],
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
 * the stored document is replaced wholesale. The one exception: if the existing
 * row has been manually edited (`edited === true`), re-extraction is a no-op —
 * the stored recipe is returned untouched so a user's customizations (edited
 * ingredients/steps, notes) are never silently overwritten. Manual edits are
 * persisted via updateRecipe(); see that function and PUT /api/recipes/[id].
 * Returns the recipe as stored, with ingredient recipe_ids rewritten to the
 * surviving id.
 *
 * Curation status is never written here (see toRowData): a re-extract keeps
 * the stored status, and a fresh save takes the DB default (saved_for_later).
 *
 * `options.autoTags`, if given, seeds tags on a brand-new row only (the
 * `create` branch of the upsert) — a re-extract of an existing URL never
 * touches tags, so auto-tagging never clobbers curation an admin has since
 * done. It's a thunk rather than a precomputed array so the (LLM-backed)
 * region-tag inference only runs when we already know the row is new —
 * every re-extract of an already-saved URL skips it entirely rather than
 * computing tags that would just be discarded. See
 * src/lib/extractors/auto-tagger.ts.
 */
export async function upsertRecipeByUrl(
  recipe: Recipe,
  options?: { autoTags?: () => Promise<string[]> }
): Promise<Recipe> {
  const url = normalizeUrl(recipe.url);
  const existing = await prisma.recipe.findUnique({ where: { url } });

  // Protect user edits: a re-extract must not clobber a customized recipe.
  if (existing?.edited) {
    return rowToRecipe(existing);
  }

  const id = existing?.id ?? recipe.id;
  const stored = withRecipeId({ ...recipe, url }, id);
  const data = toRowData(stored, url);
  const autoTags = existing ? [] : (await options?.autoTags?.()) ?? [];

  const row = await prisma.recipe.upsert({
    where: { url },
    create: { id, ...data, tags: autoTags },
    update: data,
  });
  return rowToRecipe(row);
}

/** Fields a user may customize on a saved recipe. All optional (partial patch). */
export interface RecipeUpdate {
  title?: string;
  base_servings?: number;
  /** recipe_id is re-derived from the row id, so callers needn't supply it. */
  ingredients?: Array<Omit<RecipeIngredient, "recipe_id"> & { recipe_id?: string }>;
  instructions?: InstructionStep[];
  notes?: string | null;
}

/**
 * Persist a user's manual edits to a saved recipe and flag it as `edited` so a
 * future re-extract of the same URL won't overwrite the customization (see
 * upsertRecipeByUrl). Ingredient recipe_ids are rewritten to the row id via
 * withRecipeId. Returns the updated Recipe, or null if no row matches `id`.
 */
export async function updateRecipe(
  id: string,
  patch: RecipeUpdate
): Promise<Recipe | null> {
  const data: Prisma.RecipeUpdateInput = { edited: true };
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.base_servings !== undefined) data.baseServings = patch.base_servings;
  if (patch.instructions !== undefined) {
    data.instructions = patch.instructions as unknown as Prisma.InputJsonValue;
  }
  if (patch.ingredients !== undefined) {
    // Keep the embedded recipe_id consistent with the row id.
    const ingredients = patch.ingredients.map((ing) => ({
      ...ing,
      recipe_id: id,
    }));
    data.ingredients = ingredients as unknown as Prisma.InputJsonValue;
  }
  if (patch.notes !== undefined) data.notes = patch.notes;

  try {
    const row = await prisma.recipe.update({ where: { id }, data });
    return rowToRecipe(row);
  } catch (err) {
    // P2025 = record not found → null; other errors propagate (→ 500)
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2025"
    ) {
      return null;
    }
    throw err;
  }
}

/**
 * Normalize a raw tag list: trim whitespace, drop empties, dedupe
 * case-insensitively (first-seen casing wins). The single place tag hygiene
 * is enforced, regardless of caller.
 */
function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const trimmed = tag.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

/** Fields settable via setRecipeMetadata. At least one should be present. */
export interface RecipeMetadataPatch {
  status?: RecipeStatus;
  tags?: string[];
}

/**
 * Set curation status and/or tags. Deliberately separate from updateRecipe():
 * this is metadata, not a content edit, so it must NOT flip `edited` (which
 * would show "Customized" and block re-extract refresh). Both fields are
 * written in a single `prisma.recipe.update()` call so a caller setting both
 * at once gets an atomic write rather than two independent round trips.
 * Returns the updated Recipe, or null if no row matches `id`.
 */
export async function setRecipeMetadata(
  id: string,
  patch: RecipeMetadataPatch
): Promise<Recipe | null> {
  const data: Prisma.RecipeUpdateInput = {};
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.tags !== undefined) data.tags = normalizeTags(patch.tags);

  try {
    const row = await prisma.recipe.update({ where: { id }, data });
    return rowToRecipe(row);
  } catch (err) {
    // P2025 = record not found → null; other errors propagate (→ 500)
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2025"
    ) {
      return null;
    }
    throw err;
  }
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
