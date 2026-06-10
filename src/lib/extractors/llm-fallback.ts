/**
 * LLM-based recipe extraction fallback.
 *
 * Used when schema.org JSON-LD extraction fails or returns no ingredients.
 * Expected to fire rarely for the four primary target sites.
 *
 * Sends the stripped body text to Claude and asks for structured JSON output.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Recipe, RecipeIngredient } from "@/types";
import { inferCuisineSource } from "@/lib/normalizers/lookup";
import { v4 as uuidv4 } from "uuid";

const client = new Anthropic();

// ─── Response schema ──────────────────────────────────────────────────────────

const LlmIngredientSchema = z.object({
  raw_text: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  name: z.string(),
});

const LlmRecipeSchema = z.object({
  title: z.string(),
  base_servings: z.number().int().positive(),
  ingredients: z.array(LlmIngredientSchema),
  instructions: z.array(z.string()).default([]),
});

type LlmRecipe = z.infer<typeof LlmRecipeSchema>;

// ─── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a recipe parser. Extract structured recipe data from webpage text.

Return ONLY valid JSON with this exact schema (no markdown, no extra text):
{
  "title": "recipe name",
  "base_servings": 4,
  "ingredients": [
    {
      "raw_text": "2 cups all-purpose flour",
      "quantity": 2,
      "unit": "cups",
      "name": "all-purpose flour"
    }
  ],
  "instructions": [
    "Preheat the oven to 180°C.",
    "Mix the flour and sugar in a large bowl."
  ]
}

Rules:
- title: the recipe name
- base_servings: integer servings the recipe makes. If a range, use the lower bound.
- ingredients: one object per ingredient line
  - raw_text: the full original ingredient string
  - quantity: numeric amount (null if "to taste" or unspecified)
  - unit: unit of measure lowercase (null if count/unspecified)
  - name: ONLY the ingredient name — no quantity, unit, or prep notes
- instructions: one string per cooking step, in order
  - Do NOT include step numbers in the text
  - Use [] if no cooking steps are found`;

// ─── Main function ────────────────────────────────────────────────────────────

export interface LlmExtractionResult {
  recipe: Recipe | null;
  error?: string;
}

/**
 * Extract recipe from page text using Claude API.
 *
 * @param bodyText  Cleaned body text from extractBodyText()
 * @param url       Source URL
 */
export async function extractWithLlm(
  bodyText: string,
  url: string
): Promise<LlmExtractionResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { recipe: null, error: "ANTHROPIC_API_KEY not set" };
  }

  // Truncate to ~50k chars to stay well within context limits
  const truncated = bodyText.slice(0, 50000);

  let rawJson: string;
  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      // Instructions roughly double the output size vs. ingredients alone
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: `Extract the recipe from this webpage text:\n\n${truncated}`,
        },
      ],
      system: SYSTEM_PROMPT,
    });

    const content = message.content[0];
    if (content.type !== "text") {
      return { recipe: null, error: "LLM returned non-text content" };
    }
    rawJson = content.text.trim();
  } catch (err) {
    return {
      recipe: null,
      error: `LLM API call failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Parse and validate the JSON response
  let parsed: LlmRecipe;
  try {
    const jsonData = JSON.parse(rawJson);
    parsed = LlmRecipeSchema.parse(jsonData);
  } catch (err) {
    return {
      recipe: null,
      error: `LLM response failed validation: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const recipeId = uuidv4();
  const ingredients: RecipeIngredient[] = parsed.ingredients.map((ing) => ({
    recipe_id: recipeId,
    raw_text: ing.raw_text,
    quantity: ing.quantity,
    unit: ing.unit,
    name: ing.name,
    canonical_id: null,
  }));

  const recipe: Recipe = {
    id: recipeId,
    url,
    title: parsed.title,
    base_servings: parsed.base_servings,
    parsed_at: new Date().toISOString(),
    cuisine_source: inferCuisineSource(url),
    ingredients,
    instructions: parsed.instructions,
  };

  return { recipe };
}
