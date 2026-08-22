/**
 * Automatic recipe tagging on import.
 *
 * Two independent signal sources, both near-zero cost:
 *   - Ingredient tags (protein/base-carb, e.g. "Chicken", "Rice"): deterministic,
 *     $0 — reuses the ingredient registry's alias lookup and a curated
 *     `tag_hints` field on the relevant CanonicalIngredient entries.
 *   - Region tags (e.g. "Chinese", "Italian"): one small Haiku call per import,
 *     constrained to a closed vocabulary and gated on confidence so an unsure
 *     model contributes no tag rather than a guess.
 *
 * Fail-gracefully contract: inferRegionTags/inferAutoTags never throw — a
 * tagging failure must never block saving the recipe. Missing API key, API
 * errors, or unparseable output all degrade to no region tags.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Recipe } from "@/types";
import { lookupIngredient } from "@/lib/normalizers/lookup";
import { extractJsonText } from "./llm-fallback";

const client = new Anthropic();

// ─── Ingredient-driven tags (protein / base carb) ─────────────────────────────

/**
 * Collect tag_hints from every raw ingredient that resolves via registry
 * lookup. Pure and synchronous — no network call, so recall is bounded by
 * what's already in the registry, but precision is as high as the curated
 * tag_hints data.
 */
export function inferIngredientTags(
  recipe: Pick<Recipe, "ingredients" | "cuisine_source">
): string[] {
  const tags = new Set<string>();
  for (const ingredient of recipe.ingredients) {
    const result = lookupIngredient(ingredient.name, recipe.cuisine_source);
    for (const hint of result.canonical?.tag_hints ?? []) {
      tags.add(hint);
    }
  }
  return Array.from(tags);
}

// ─── Region/cuisine tags (LLM) ─────────────────────────────────────────────────

const REGION_TAGS = [
  "Italian",
  "Chinese",
  "Japanese",
  "Korean",
  "Thai",
  "Vietnamese",
  "Singaporean",
  "Malaysian",
  "Indonesian",
  "Indian",
  "Mexican",
  "French",
  "Greek",
  "Spanish",
  "Middle Eastern",
  "Mediterranean",
  "American",
  "British",
  "Filipino",
] as const;

const RegionTagsSchema = z.object({
  region_tags: z
    .array(z.object({ tag: z.enum(REGION_TAGS), confidence: z.number().min(0).max(1) }))
    .max(2),
});

const CONFIDENCE_THRESHOLD = 0.7;
const MAX_REGION_TAGS = 2;

const SYSTEM_PROMPT = `You classify a recipe's cuisine of origin. Given a recipe's title and main ingredients, pick 0-2 region tags from this fixed list ONLY:
${REGION_TAGS.join(", ")}

Return ONLY valid JSON (no markdown, no extra text):
{ "region_tags": [{ "tag": "Chinese", "confidence": 0.9 }] }

Rules:
- tag must be exactly one of the listed values — never invent a new one.
- Only include a tag if you're genuinely confident (confidence >= 0.7); if the cuisine is ambiguous or unclear, return an empty array.
- Most recipes have exactly one clear region; only use two when the dish is a genuine fusion (e.g. Chinese-American).`;

/**
 * Infer 0-2 closed-vocabulary region/cuisine tags for a recipe via a single
 * small Haiku call. Returns [] on missing API key, API error, or unparseable/
 * low-confidence output — never throws.
 */
export async function inferRegionTags(
  recipe: Pick<Recipe, "title" | "ingredients">
): Promise<string[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];

  const ingredientNames = recipe.ingredients.slice(0, 10).map((i) => i.name);

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: `Title: ${recipe.title}\nMain ingredients: ${ingredientNames.join(", ") || "(none listed)"}`,
        },
      ],
      system: SYSTEM_PROMPT,
    });

    const content = message.content[0];
    if (content.type !== "text") return [];

    const parsed = RegionTagsSchema.parse(JSON.parse(extractJsonText(content.text)));
    return parsed.region_tags
      .filter((t) => t.confidence >= CONFIDENCE_THRESHOLD)
      .slice(0, MAX_REGION_TAGS)
      .map((t) => t.tag);
  } catch (err) {
    console.error(
      `Region tag inference failed (recipe saved without region tags): ${err instanceof Error ? err.message : String(err)}`
    );
    return [];
  }
}

// ─── Combined entry point ──────────────────────────────────────────────────────

/**
 * Infer all auto-tags for a freshly extracted recipe: ingredient-driven tags
 * (protein/base carb) plus an LLM-inferred region tag. Deduped
 * case-insensitively, first-seen casing wins (same rule as normalizeTags in
 * src/lib/db/recipes.ts).
 */
export async function inferAutoTags(
  recipe: Pick<Recipe, "title" | "ingredients" | "cuisine_source">
): Promise<string[]> {
  const ingredientTags = inferIngredientTags(recipe);
  const regionTags = await inferRegionTags(recipe);

  const seen = new Set<string>();
  const tags: string[] = [];
  for (const tag of [...regionTags, ...ingredientTags]) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}
