/**
 * LLM-based normalization fallback.
 *
 * Called in batch for ingredient names that couldn't be resolved by alias lookup.
 * Batches up to 50 names per Claude API call to minimise cost.
 *
 * Results are cached in-memory so repeated identical ingredient names (very
 * common) don't trigger additional API calls.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getRegistrySummary } from "@/lib/registry/registry";
import type { NormalizationResult } from "@/types";

const client = new Anthropic();

// ─── In-memory cache ──────────────────────────────────────────────────────────

const resultCache = new Map<string, NormalizationResult>();

// ─── Response schema ──────────────────────────────────────────────────────────

const MatchSchema = z.object({
  input: z.string(),
  canonical_id: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

const ResponseSchema = z.array(MatchSchema);

// ─── Build prompt ─────────────────────────────────────────────────────────────

function buildPrompt(names: string[]): string {
  const registrySummary = getRegistrySummary()
    .slice(0, 200) // send first 200 entries to stay within context
    .map((e) => `${e.id}: ${e.name} (${e.aliases.slice(0, 4).join(", ")})`)
    .join("\n");

  return `Match each ingredient name to the most appropriate canonical ingredient ID from the registry below.

Registry (id: name (aliases)):
${registrySummary}

Ingredient names to match:
${names.map((n, i) => `${i + 1}. ${n}`).join("\n")}

Return ONLY a JSON array with one object per input:
[{"input": "original name", "canonical_id": "matched_id_or_null", "confidence": 0.0-1.0}]

Rules:
- canonical_id must be exactly one of the IDs listed above, or null
- Set confidence >= 0.8 only if you're highly confident
- If confidence < 0.7, use canonical_id: null
- Do not invent IDs — only use IDs from the registry`;
}

// ─── Main batch function ──────────────────────────────────────────────────────

const BATCH_SIZE = 50;
const CONFIDENCE_THRESHOLD = 0.7;

/**
 * Resolve a list of unmatched ingredient names via Claude API.
 * Results with confidence < CONFIDENCE_THRESHOLD return canonical_id: null.
 *
 * @param names  Ingredient names that failed alias lookup
 * @returns Map of name → NormalizationResult
 */
export async function batchNormalizeWithLlm(
  names: string[]
): Promise<Map<string, NormalizationResult>> {
  const results = new Map<string, NormalizationResult>();

  if (names.length === 0) return results;
  if (!process.env.ANTHROPIC_API_KEY) {
    // Return unknown for all — graceful degradation without API key
    for (const name of names) {
      results.set(name, { canonical_id: null, canonical: null, method: "unknown", confidence: 0 });
    }
    return results;
  }

  // Separate cached from uncached
  const uncached: string[] = [];
  for (const name of names) {
    const cached = resultCache.get(name);
    if (cached) {
      results.set(name, cached);
    } else {
      uncached.push(name);
    }
  }

  if (uncached.length === 0) return results;

  // Process in batches
  for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
    const batch = uncached.slice(i, i + BATCH_SIZE);
    const batchResults = await processBatch(batch);
    for (const [name, result] of Array.from(batchResults.entries())) {
      results.set(name, result);
      resultCache.set(name, result);
    }
  }

  return results;
}

async function processBatch(
  names: string[]
): Promise<Map<string, NormalizationResult>> {
  const results = new Map<string, NormalizationResult>();
  const unknown: NormalizationResult = {
    canonical_id: null,
    canonical: null,
    method: "unknown",
    confidence: 0,
  };

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      messages: [
        { role: "user", content: buildPrompt(names) },
      ],
    });

    const content = message.content[0];
    if (content.type !== "text") throw new Error("Non-text response from LLM");

    const rawJson = content.text.trim();
    const parsed = ResponseSchema.parse(JSON.parse(rawJson));

    for (const match of parsed) {
      const result: NormalizationResult =
        match.canonical_id && match.confidence >= CONFIDENCE_THRESHOLD
          ? {
              canonical_id: match.canonical_id,
              canonical: null, // caller resolves via findById if needed
              method: "llm",
              confidence: match.confidence,
            }
          : { ...unknown };

      results.set(match.input, result);
    }
  } catch {
    // On any error, return unknown for all names in this batch
    for (const name of names) {
      results.set(name, unknown);
    }
  }

  // Fill any names not present in the LLM response
  for (const name of names) {
    if (!results.has(name)) results.set(name, unknown);
  }

  return results;
}

/** Clear the in-memory cache (useful for testing) */
export function clearNormalizationCache(): void {
  resultCache.clear();
}
