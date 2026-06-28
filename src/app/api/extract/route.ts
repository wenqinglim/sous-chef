/**
 * POST /api/extract
 *
 * Server-side recipe extraction from a URL, streamed as Server-Sent Events.
 *
 * Body:  { url?: string, text?: string }   — at least one required
 *   url  — a recipe website or Instagram reel to fetch + extract
 *   text — pasted caption/recipe text to extract directly (no fetch); the
 *          manual fallback when an Instagram reel can't be fetched. `url`, if
 *          also given, is kept as the recipe's source link.
 *
 * Response: text/event-stream, 200 OK (stream always opens; errors arrive as events)
 *   { type: "status",  message: string }          — progress update (Instagram audio path)
 *   { type: "result",  recipe: Recipe, saved: boolean }
 *   { type: "error",   error: string, status: number }  — 400 / 422 / 502 semantics
 *
 * Pre-stream 400: invalid JSON body or invalid URL (before stream opens).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Recipe } from "@/types";
import { extractFromSchemaOrg, extractBodyText } from "@/lib/extractors/schema-org";
import { extractWithLlm } from "@/lib/extractors/llm-fallback";
import {
  isInstagramUrl,
  extractFromInstagramWithAudio,
} from "@/lib/extractors/instagram";
import { safeFetch, BlockedUrlError } from "@/lib/extractors/safe-fetch";
import { upsertRecipeByUrl } from "@/lib/db/recipes";

export const maxDuration = 60;

// Either a URL to fetch, or pasted caption/recipe text (the manual fallback when
// an Instagram reel can't be fetched automatically). `url` is still optional in
// paste mode so the saved recipe can link back to (and dedupe against) the reel.
const RequestSchema = z
  .object({
    url: z.string().url().optional(),
    text: z.string().trim().min(1).optional(),
  })
  .refine((d) => d.url || d.text, {
    message: "Provide a recipe URL or pasted recipe text",
  });

const encoder = new TextEncoder();

function emit(controller: ReadableStreamDefaultController, payload: object) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
}

async function saveExtracted(
  recipe: Recipe,
  controller: ReadableStreamDefaultController
) {
  try {
    const saved = await upsertRecipeByUrl(recipe);
    emit(controller, { type: "result", recipe: saved, saved: true });
  } catch (err) {
    console.error(`Failed to save recipe to library (${recipe.url}):`, err);
    emit(controller, { type: "result", recipe, saved: false });
  }
}

export async function POST(request: NextRequest) {
  // Validate request body before opening the stream.
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

  const { url, text } = parsed.data;
  const instagram = url ? isInstagramUrl(url) : false;

  const stream = new ReadableStream({
    async start(controller) {
      const onStatus = (msg: string) =>
        emit(controller, { type: "status", message: msg });

      // ── Pasted-text branch ──────────────────────────────────────────────
      // No fetching: the user supplied the caption/recipe text directly (the
      // manual fallback when an Instagram reel can't be fetched). A synthesized
      // url keeps each pasted recipe deduped to its own library row.
      if (text) {
        // Reuse the reel URL when given (links back + dedupes); else a unique one.
        const recipeUrl = url ?? `paste:${crypto.randomUUID()}`;
        const llmResult = await extractWithLlm(text, recipeUrl);
        if (llmResult.recipe) {
          await saveExtracted(llmResult.recipe, controller);
        } else {
          const status = llmResult.kind === "no_recipe" ? 422 : 502;
          emit(controller, {
            type: "error",
            error:
              llmResult.error ??
              "Could not find a recipe in the pasted text",
            status,
          });
        }
        controller.close();
        return;
      }

      // ── Instagram branch (scraper-sourced; no upfront page fetch) ────────
      if (instagram) {
        const igResult = await extractFromInstagramWithAudio(url!, onStatus);
        if (igResult.recipe) {
          await saveExtracted(igResult.recipe, controller);
        } else {
          const status = igResult.kind === "no_recipe" ? 422 : 502;
          emit(controller, {
            type: "error",
            error:
              igResult.error ??
              "Could not find a recipe in this Instagram reel",
            status,
          });
        }
        controller.close();
        return;
      }

      // ── Fetch the page (websites) ───────────────────────────────────────
      // Past the text + Instagram branches, the schema's refine guarantees a url.
      const pageUrl = url!;
      let html: string;
      try {
        const result = await safeFetch(pageUrl, {});
        if (!result.ok) {
          emit(controller, {
            type: "error",
            error: `Failed to fetch URL: HTTP ${result.status}`,
            status: 502,
          });
          controller.close();
          return;
        }
        html = result.text;
      } catch (err) {
        if (err instanceof BlockedUrlError) {
          emit(controller, { type: "error", error: err.message, status: 400 });
        } else {
          const message = err instanceof Error ? err.message : String(err);
          emit(controller, {
            type: "error",
            error: `Failed to fetch URL: ${message}`,
            status: 502,
          });
        }
        controller.close();
        return;
      }

      // ── Non-Instagram branch ────────────────────────────────────────────
      const schemaResult = extractFromSchemaOrg(html, pageUrl);
      if (schemaResult.recipe) {
        await saveExtracted(schemaResult.recipe, controller);
        controller.close();
        return;
      }

      const bodyText = extractBodyText(html);
      const llmResult = await extractWithLlm(bodyText, pageUrl);
      if (llmResult.recipe) {
        await saveExtracted(llmResult.recipe, controller);
      } else {
        emit(controller, {
          type: "error",
          error:
            llmResult.error ??
            schemaResult.error ??
            "Could not extract recipe from this URL",
          status: 422,
        });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
