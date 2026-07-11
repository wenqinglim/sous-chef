/**
 * GET /api/recipes
 *
 * List the saved recipe library (summaries only — full documents are
 * fetched per-recipe via /api/recipes/[id]).
 *
 * The response varies by the admin cookie: non-admins only see
 * "tried_and_tested" recipes; admins see everything (hence no-store).
 *
 * 200:   { recipes: RecipeSummary[] }
 * 500:   { error: string }
 */

import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { listRecipes } from "@/lib/db/recipes";

// The body varies by the admin cookie (on every branch), so nothing here may
// be cached by an intermediary.
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const recipes = await listRecipes({ includeUntried: await isAdmin() });
    return NextResponse.json({ recipes }, { headers: NO_STORE });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to load recipe library: ${message}` },
      { status: 500, headers: NO_STORE }
    );
  }
}
