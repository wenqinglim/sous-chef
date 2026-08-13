/**
 * GET    /api/recipes/[id]   → { recipe: Recipe } | 404
 * PUT    /api/recipes/[id]   → { recipe: Recipe } | 404  (persists user edits)
 * PATCH  /api/recipes/[id]   → { recipe: Recipe } | 404  (sets curation status/tags)
 * DELETE /api/recipes/[id]   → { ok: true }       | 404
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteRecipe,
  getRecipe,
  setRecipeMetadata,
  updateRecipe,
} from "@/lib/db/recipes";
import { normalizeInstructions } from "@/lib/recipe/sections";
import { requireAdmin } from "@/lib/auth";

type RouteContext = { params: Promise<{ id: string }> };

// Partial patch — only the fields a user may customize. recipe_id on each
// ingredient is re-derived server-side, so it isn't required here.
const IngredientSchema = z.object({
  raw_text: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  name: z.string(),
  canonical_id: z.string().nullable(),
  section: z.string().nullable().optional(),
});

// Accept grouped step objects or plain strings (older clients) — coerced below.
const InstructionSchema = z.union([
  z.string(),
  z.object({ text: z.string(), section: z.string().nullable().optional() }),
]);

const UpdateSchema = z
  .object({
    title: z.string().min(1),
    base_servings: z.number().int().positive(),
    ingredients: z.array(IngredientSchema),
    instructions: z.array(InstructionSchema),
    notes: z.string().nullable(),
  })
  .partial();

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  try {
    const recipe = await getRecipe(id);
    if (!recipe) {
      return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
    }
    return NextResponse.json({ recipe });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to load recipe: ${message}` },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  // Reject a no-op patch: an empty body would otherwise flag the recipe
  // `edited` (disabling re-extract refresh) without changing anything.
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json(
      { error: "No editable fields provided" },
      { status: 400 }
    );
  }

  // updateRecipe re-derives each ingredient's recipe_id from the row id, so the
  // validated body can go straight through. Instructions are coerced to the
  // InstructionStep shape (tolerating a legacy string[] payload).
  const { instructions, ...rest } = parsed.data;
  const patch = {
    ...rest,
    ...(instructions !== undefined
      ? { instructions: normalizeInstructions(instructions) }
      : {}),
  };
  try {
    const recipe = await updateRecipe(id, patch);
    if (!recipe) {
      return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
    }
    return NextResponse.json({ recipe });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to update recipe: ${message}` },
      { status: 500 }
    );
  }
}

// Status and tags are deliberately not part of UpdateSchema/PUT: they're
// curation metadata, not a content edit, and must not flip the `edited` flag.
const MetadataSchema = z
  .object({
    status: z.enum(["tried_and_tested", "saved_for_later"]),
    tags: z.array(z.string()).max(20),
  })
  .partial()
  .refine((data) => data.status !== undefined || data.tags !== undefined, {
    message: "No status or tags provided",
  });

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = MetadataSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  try {
    const recipe = await setRecipeMetadata(id, parsed.data);
    if (!recipe) {
      return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
    }
    return NextResponse.json({ recipe });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to update recipe: ${message}` },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const { id } = await params;
  try {
    const deleted = await deleteRecipe(id);
    if (!deleted) {
      return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to delete recipe: ${message}` },
      { status: 500 }
    );
  }
}
