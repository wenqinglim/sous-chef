/**
 * POST /api/extract
 *
 * Server-side recipe extraction from a URL, streamed as Server-Sent Events.
 *
 * Body:  { url: string }
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
  INSTAGRAM_USER_AGENT,
} from "@/lib/extractors/instagram";
import { safeFetch, BlockedUrlError } from "@/lib/extractors/safe-fetch";
import { upsertRecipeByUrl } from "@/lib/db/recipes";

export const maxDuration = 60;

const RequestSchema = z.object({
  url: z.string().url(),
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

  const { url } = parsed.data;
  const instagram = isInstagramUrl(url);

  const stream = new ReadableStream({
    async start(controller) {
      // ── Fetch the page ──────────────────────────────────────────────────
      let html: string;
      try {
        const result = await safeFetch(
          url,
          instagram ? { userAgent: INSTAGRAM_USER_AGENT } : {}
        );
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

      // ── Instagram branch ────────────────────────────────────────────────
      if (instagram) {
        const onStatus = (msg: string) =>
          emit(controller, { type: "status", message: msg });

        const igResult = await extractFromInstagramWithAudio(html, url, onStatus);
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

      // ── Non-Instagram branch ────────────────────────────────────────────
      const schemaResult = extractFromSchemaOrg(html, url);
      if (schemaResult.recipe) {
        await saveExtracted(schemaResult.recipe, controller);
        controller.close();
        return;
      }

      const bodyText = extractBodyText(html);
      const llmResult = await extractWithLlm(bodyText, url);
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
