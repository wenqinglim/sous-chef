/**
 * POST /api/grocery-list
 *
 * Full pipeline: normalize → aggregate → purchase plan → grouped list.
 *
 * Body:  { mealPlan: MealPlan, recipes: Recipe[] }
 * 200:   GroceryListResponse
 * 400:   { error: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const maxDuration = 60;
import { derive } from "@/lib/derive";
import type { MealPlan, Recipe } from "@/types";

const IngredientSchema = z.object({
  recipe_id: z.string(),
  raw_text: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  name: z.string(),
  canonical_id: z.string().nullable(),
});

const RecipeSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  base_servings: z.number().positive(),
  parsed_at: z.string(),
  cuisine_source: z.enum(["asian", "western", "unknown"]),
  ingredients: z.array(IngredientSchema),
  // Tolerate recipes cached before instructions existed
  instructions: z.array(z.string()).default([]),
});

const RequestSchema = z.object({
  mealPlan: z.object({
    id: z.string(),
    name: z.string().nullable(),
    recipes: z.array(
      z.object({
        recipe_id: z.string(),
        target_servings: z.number().positive(),
      })
    ),
  }),
  recipes: z.array(RecipeSchema),
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

  const { mealPlan, recipes } = parsed.data;

  const recipeMap = new Map<string, Recipe>(
    recipes.map((r) => [r.id, r as Recipe])
  );

  const result = await derive(mealPlan as MealPlan, recipeMap);

  return NextResponse.json({
    items: result.items,
    unresolvable: result.unresolvable,
    grouped_by_aisle: result.grouped_by_aisle,
  });
}
