/**
 * POST /api/extract
 *
 * Server-side recipe extraction from a URL.
 * Must be server-side to avoid CORS restrictions.
 *
 * Body:  { url: string }
 * 200:   { recipe: Recipe, saved: boolean }  (saved=false when the DB is unreachable)
 * 400:   { error: string }  (invalid URL)
 * 422:   { error: string }  (extraction failed — no ingredients found)
 * 502:   { error: string }  (fetch failed)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Recipe } from "@/types";
import { extractFromSchemaOrg, extractBodyText } from "@/lib/extractors/schema-org";
import { extractWithLlm } from "@/lib/extractors/llm-fallback";
import { safeFetch, BlockedUrlError } from "@/lib/extractors/safe-fetch";
import { upsertRecipeByUrl } from "@/lib/db/recipes";

/**
 * Auto-save the extracted recipe to the shared library, deduping by URL.
 * Extraction must keep working when the DB is down/cold, so failures degrade
 * to saved: false with the unsaved recipe.
 */
async function saveExtracted(recipe: Recipe) {
  try {
    const saved = await upsertRecipeByUrl(recipe);
    return NextResponse.json({ recipe: saved, saved: true });
  } catch (err) {
    console.error(`Failed to save recipe to library (${recipe.url}):`, err);
    return NextResponse.json({ recipe, saved: false });
  }
}

export const maxDuration = 60;

const RequestSchema = z.object({
  url: z.string().url(),
});

export async function POST(request: NextRequest) {
  // Parse and validate request body
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

  const { url } = parsed.data;

  // Fetch the recipe page server-side (bypasses CORS) through the SSRF-safe
  // wrapper, since we now accept arbitrary user-supplied URLs.
  let html: string;
  try {
    const result = await safeFetch(url);
    if (!result.ok) {
      return NextResponse.json(
        { error: `Failed to fetch URL: HTTP ${result.status}` },
        { status: 502 }
      );
    }
    html = result.text;
  } catch (err) {
    if (err instanceof BlockedUrlError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to fetch URL: ${message}` },
      { status: 502 }
    );
  }

  // Try schema.org extraction first
  const schemaResult = extractFromSchemaOrg(html, url);
  if (schemaResult.recipe) {
    return saveExtracted(schemaResult.recipe);
  }

  // Fall back to LLM extraction
  const bodyText = extractBodyText(html);
  const llmResult = await extractWithLlm(bodyText, url);
  if (llmResult.recipe) {
    return saveExtracted(llmResult.recipe);
  }

  return NextResponse.json(
    {
      error:
        llmResult.error ??
        schemaResult.error ??
        "Could not extract recipe from this URL",
    },
    { status: 422 }
  );
}
