/**
 * GET    /api/recipes/[id]   → { recipe: Recipe } | 404
 * PUT    /api/recipes/[id]   → { recipe: Recipe } | 404  (persists user edits)
 * DELETE /api/recipes/[id]   → { ok: true }       | 404
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deleteRecipe, getRecipe, updateRecipe } from "@/lib/db/recipes";

type RouteContext = { params: Promise<{ id: string }> };

// Partial patch — only the fields a user may customize. recipe_id on each
// ingredient is re-derived server-side, so it isn't required here.
const IngredientSchema = z.object({
  raw_text: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  name: z.string(),
  canonical_id: z.string().nullable(),
});

const UpdateSchema = z
  .object({
    title: z.string().min(1),
    base_servings: z.number().int().positive(),
    ingredients: z.array(IngredientSchema),
    instructions: z.array(z.string()),
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

  const { ingredients, ...rest } = parsed.data;
  try {
    const recipe = await updateRecipe(id, {
      ...rest,
      // Re-derive recipe_id server-side so it stays consistent with the row id.
      ...(ingredients
        ? { ingredients: ingredients.map((ing) => ({ ...ing, recipe_id: id })) }
        : {}),
    });
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
