/**
 * POST /api/extract
 *
 * Server-side recipe extraction from a URL.
 * Must be server-side to avoid CORS restrictions.
 *
 * Body:  { url: string }
 * 200:   { recipe: Recipe }
 * 400:   { error: string }  (invalid URL)
 * 422:   { error: string }  (extraction failed — no ingredients found)
 * 502:   { error: string }  (fetch failed)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { extractFromSchemaOrg, extractBodyText } from "@/lib/extractors/schema-org";
import { extractWithLlm } from "@/lib/extractors/llm-fallback";

export const maxDuration = 60;

const ALLOWED_HOSTS = [
  "recipetineats.com",
  "thewoksoflife.com",
  "hot-thai-kitchen.com",
  "madewithlau.com",
];

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

  const hostname = new URL(url).hostname.replace(/^www\./, "");
  if (!ALLOWED_HOSTS.some((h) => hostname === h || hostname.endsWith("." + h))) {
    return NextResponse.json({ error: "URL not from a supported recipe site" }, { status: 400 });
  }

  // Fetch the recipe page (server-side to bypass CORS).
  let html: string;
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(15000), // 15s timeout
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch URL: HTTP ${response.status}` },
        { status: 502 }
      );
    }

    html = await response.text();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to fetch URL: ${message}` },
      { status: 502 }
    );
  }

  // Try schema.org extraction first
  const schemaResult = extractFromSchemaOrg(html, url);
  if (schemaResult.recipe) {
    return NextResponse.json({ recipe: schemaResult.recipe });
  }

  // Fall back to LLM extraction
  const bodyText = extractBodyText(html);
  const llmResult = await extractWithLlm(bodyText, url);
  if (llmResult.recipe) {
    return NextResponse.json({ recipe: llmResult.recipe });
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
