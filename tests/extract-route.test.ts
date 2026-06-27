/**
 * Tests for POST /api/extract — focused on the pasted-text branch (the manual
 * fallback): pasted `text` is extracted directly via the LLM with no fetching.
 */

jest.mock("@/lib/db/recipes", () => ({ upsertRecipeByUrl: jest.fn() }));
jest.mock("@/lib/extractors/llm-fallback", () => ({ extractWithLlm: jest.fn() }));
jest.mock("@/lib/extractors/instagram", () => ({
  isInstagramUrl: jest.fn().mockReturnValue(false),
  extractFromInstagramWithAudio: jest.fn(),
}));
jest.mock("@/lib/extractors/schema-org", () => ({
  extractFromSchemaOrg: jest.fn(),
  extractBodyText: jest.fn(),
}));
jest.mock("@/lib/extractors/safe-fetch", () => ({
  safeFetch: jest.fn(),
  BlockedUrlError: class BlockedUrlError extends Error {},
}));

import { POST } from "@/app/api/extract/route";
import { extractWithLlm } from "@/lib/extractors/llm-fallback";
import { upsertRecipeByUrl } from "@/lib/db/recipes";
import { safeFetch } from "@/lib/extractors/safe-fetch";
import { extractFromInstagramWithAudio } from "@/lib/extractors/instagram";
import type { Recipe } from "@/types";

const mockedExtractWithLlm = extractWithLlm as jest.MockedFunction<typeof extractWithLlm>;
const mockedUpsert = upsertRecipeByUrl as jest.MockedFunction<typeof upsertRecipeByUrl>;
const mockedSafeFetch = safeFetch as jest.MockedFunction<typeof safeFetch>;
const mockedIgAudio = extractFromInstagramWithAudio as jest.MockedFunction<
  typeof extractFromInstagramWithAudio
>;

const REEL_URL = "https://www.instagram.com/reel/ABC123/";

const recipe: Recipe = {
  id: "rid",
  url: REEL_URL,
  title: "Garlic Butter Noodles",
  base_servings: 2,
  parsed_at: new Date().toISOString(),
  cuisine_source: "unknown",
  ingredients: [],
  instructions: ["Boil noodles."],
};

function makeRequest(body: unknown) {
  return { json: async () => body } as unknown as Parameters<typeof POST>[0];
}

/** Read an SSE Response stream into an array of parsed event objects. */
async function readEvents(res: Response): Promise<Array<Record<string, unknown>>> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: Array<Record<string, unknown>> = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.trim();
      if (line.startsWith("data: ")) events.push(JSON.parse(line.slice(6)));
    }
  }
  return events;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("POST /api/extract — pasted text branch", () => {
  test("extracts pasted text directly and skips fetching", async () => {
    mockedExtractWithLlm.mockResolvedValue({ recipe });
    mockedUpsert.mockResolvedValue(recipe);

    const res = await POST(makeRequest({ url: REEL_URL, text: "200g noodles. Method: boil." }));
    const events = await readEvents(res);

    // The pasted text went to the LLM with the reel URL preserved as the source.
    expect(mockedExtractWithLlm).toHaveBeenCalledWith("200g noodles. Method: boil.", REEL_URL);
    // No fetching of any kind.
    expect(mockedSafeFetch).not.toHaveBeenCalled();
    expect(mockedIgAudio).not.toHaveBeenCalled();
    // Result emitted with the saved recipe.
    const result = events.find((e) => e.type === "result");
    expect(result).toMatchObject({ saved: true, recipe: { id: "rid" } });
  });

  test("synthesizes a unique url when text is pasted without a url", async () => {
    mockedExtractWithLlm.mockResolvedValue({ recipe });
    mockedUpsert.mockResolvedValue(recipe);

    await POST(makeRequest({ text: "1 cup flour, 2 eggs. Method: mix and bake." }));

    const [, urlArg] = mockedExtractWithLlm.mock.calls[0];
    expect(urlArg).toMatch(/^paste:/);
  });

  test("emits an error event when the pasted text isn't a recipe", async () => {
    mockedExtractWithLlm.mockResolvedValue({
      recipe: null,
      error: "Not a recipe",
      kind: "no_recipe",
    });

    const res = await POST(makeRequest({ text: "just some vibes at the beach today" }));
    const events = await readEvents(res);

    const err = events.find((e) => e.type === "error");
    expect(err).toMatchObject({ status: 422 });
    expect(mockedSafeFetch).not.toHaveBeenCalled();
  });
});
