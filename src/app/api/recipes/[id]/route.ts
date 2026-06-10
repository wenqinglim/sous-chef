/**
 * GET    /api/recipes/[id]   → { recipe: Recipe } | 404
 * DELETE /api/recipes/[id]   → { ok: true }       | 404
 */

import { NextRequest, NextResponse } from "next/server";
import { deleteRecipe, getRecipe } from "@/lib/db/recipes";

type RouteContext = { params: Promise<{ id: string }> };

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
