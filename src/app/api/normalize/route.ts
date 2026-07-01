/**
 * POST /api/normalize
 *
 * Normalize a list of raw ingredient texts from a recipe.
 * Runs registry lookup first; batches unknowns to Claude for resolution.
 *
 * Body:  { recipe: Recipe }
 *        (full Recipe object — we need cuisine_source + base_servings)
 * 200:   { normalized: NormalizedIngredient[], unresolvable: UnresolvableIngredient[] }
 * 400:   { error: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const maxDuration = 60;
import { normalizeRecipe } from "@/lib/pipeline/normalize";
import type { Recipe } from "@/types";

const RequestSchema = z.object({
  recipe: z.object({
    id: z.string(),
    url: z.string(),
    title: z.string(),
    base_servings: z.number().positive(),
    parsed_at: z.string(),
    cuisine_source: z.enum(["asian", "western", "unknown"]),
    ingredients: z.array(
      z.object({
        recipe_id: z.string(),
        raw_text: z.string(),
        quantity: z.number().nullable(),
        unit: z.string().nullable(),
        name: z.string(),
        canonical_id: z.string().nullable(),
      })
    ),
    // Tolerate recipes cached before instructions existed, plus both the legacy
    // string[] and current InstructionStep[] shapes (normalize ignores them).
    instructions: z
      .array(
        z.union([
          z.string(),
          z.object({ text: z.string(), section: z.string().nullable().optional() }),
        ])
      )
      .default([]),
  }),
  target_servings: z.number().positive().optional(),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const { recipe, target_servings } = parsed.data;
  const targetServings = target_servings ?? recipe.base_servings;

  const result = await normalizeRecipe(recipe as Recipe, targetServings);

  return NextResponse.json({
    normalized: result.normalized,
    unresolvable: result.unresolvable,
  });
}
