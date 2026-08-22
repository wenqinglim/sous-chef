/**
 * Auto-tagger tests. inferIngredientTags is pure/deterministic (real
 * registry, no mocking). The Anthropic client is mocked for inferRegionTags —
 * the contract under test is fail-gracefully: every failure mode returns [],
 * never a throw.
 */

const mockCreate = jest.fn();

jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: jest.fn(() => ({ messages: { create: mockCreate } })),
}));

import {
  inferAutoTags,
  inferIngredientTags,
  inferRegionTags,
} from "@/lib/extractors/auto-tagger";
import type { Recipe, RecipeIngredient } from "@/types";

function ing(name: string, overrides: Partial<RecipeIngredient> = {}): RecipeIngredient {
  return {
    recipe_id: "r1",
    raw_text: name,
    quantity: 1,
    unit: null,
    name,
    canonical_id: null,
    ...overrides,
  };
}

function llmResponse(json: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(json) }] };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = "test-key";
});

// ─── inferIngredientTags ────────────────────────────────────────────────────

describe("inferIngredientTags", () => {
  test("collects tag_hints from matched registry entries", () => {
    const tags = inferIngredientTags({
      ingredients: [ing("chicken breast"), ing("jasmine rice"), ing("garlic")],
      cuisine_source: "unknown",
    });
    expect(tags).toEqual(expect.arrayContaining(["Chicken", "Rice"]));
  });

  test("dedupes when multiple ingredients share a tag", () => {
    const tags = inferIngredientTags({
      ingredients: [ing("chicken breast"), ing("chicken thighs")],
      cuisine_source: "unknown",
    });
    expect(tags).toEqual(["Chicken"]);
  });

  test("ingredients with no tag_hints (or unresolved) contribute nothing", () => {
    const tags = inferIngredientTags({
      ingredients: [ing("garlic"), ing("some invented ingredient xyz")],
      cuisine_source: "unknown",
    });
    expect(tags).toEqual([]);
  });

  test("cleans adjectives before lookup, same as the normalization pipeline", () => {
    // "sliced" isn't part of the "chicken breast" alias — stripping it via
    // lookupIngredient's adjective pass is what makes this resolve at all.
    const tags = inferIngredientTags({
      ingredients: [ing("sliced chicken breast")],
      cuisine_source: "unknown",
    });
    expect(tags).toEqual(["Chicken"]);
  });

  test("firm tofu resolves to the Tofu tag", () => {
    const tags = inferIngredientTags({
      ingredients: [ing("firm tofu")],
      cuisine_source: "unknown",
    });
    expect(tags).toEqual(["Tofu"]);
  });
});

// ─── inferRegionTags ────────────────────────────────────────────────────────

const recipe: Pick<Recipe, "title" | "ingredients"> = {
  title: "Kung Pao Chicken",
  ingredients: [ing("chicken breast"), ing("peanuts"), ing("dried chili")],
};

describe("inferRegionTags", () => {
  test("accepts confident closed-vocab tags", async () => {
    mockCreate.mockResolvedValue(
      llmResponse({ region_tags: [{ tag: "Chinese", confidence: 0.95 }] })
    );
    expect(await inferRegionTags(recipe)).toEqual(["Chinese"]);
  });

  test("drops tags below the confidence threshold", async () => {
    mockCreate.mockResolvedValue(
      llmResponse({ region_tags: [{ tag: "Chinese", confidence: 0.5 }] })
    );
    expect(await inferRegionTags(recipe)).toEqual([]);
  });

  test("out-of-vocabulary tag fails schema validation → []", async () => {
    mockCreate.mockResolvedValue(
      llmResponse({ region_tags: [{ tag: "Atlantis", confidence: 0.9 }] })
    );
    expect(await inferRegionTags(recipe)).toEqual([]);
  });

  test("caps at 2 tags", async () => {
    mockCreate.mockResolvedValue(
      llmResponse({
        region_tags: [
          { tag: "Chinese", confidence: 0.9 },
          { tag: "American", confidence: 0.8 },
        ],
      })
    );
    expect(await inferRegionTags(recipe)).toEqual(["Chinese", "American"]);
  });

  test("empty region_tags → []", async () => {
    mockCreate.mockResolvedValue(llmResponse({ region_tags: [] }));
    expect(await inferRegionTags(recipe)).toEqual([]);
  });

  test("garbage output → [], no throw", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "not json" }],
    });
    expect(await inferRegionTags(recipe)).toEqual([]);
  });

  test("API error → [], no throw", async () => {
    mockCreate.mockRejectedValue(new Error("overloaded"));
    expect(await inferRegionTags(recipe)).toEqual([]);
  });

  test("missing ANTHROPIC_API_KEY → [] without calling the API", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(await inferRegionTags(recipe)).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

// ─── inferAutoTags ──────────────────────────────────────────────────────────

describe("inferAutoTags", () => {
  test("combines ingredient tags and region tags", async () => {
    mockCreate.mockResolvedValue(
      llmResponse({ region_tags: [{ tag: "Chinese", confidence: 0.9 }] })
    );
    const tags = await inferAutoTags({
      title: "Kung Pao Chicken",
      ingredients: [ing("chicken breast"), ing("jasmine rice")],
      cuisine_source: "asian",
    });
    expect(tags).toEqual(expect.arrayContaining(["Chinese", "Chicken", "Rice"]));
  });

  test("dedupes repeated ingredient tags when combining with region tags", async () => {
    mockCreate.mockResolvedValue(llmResponse({ region_tags: [] }));
    const tags = await inferAutoTags({
      title: "Chicken and Rice",
      ingredients: [ing("chicken breast"), ing("chicken thighs")],
      cuisine_source: "unknown",
    });
    expect(tags).toEqual(["Chicken"]);
  });
});
