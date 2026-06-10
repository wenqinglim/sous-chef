/**
 * GET /api/recipes
 *
 * List the saved recipe library (summaries only — full documents are
 * fetched per-recipe via /api/recipes/[id]).
 *
 * 200:   { recipes: RecipeSummary[] }
 * 500:   { error: string }
 */

import { NextResponse } from "next/server";
import { listRecipes } from "@/lib/db/recipes";

export async function GET() {
  try {
    const recipes = await listRecipes();
    return NextResponse.json({ recipes });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to load recipe library: ${message}` },
      { status: 500 }
    );
  }
}
