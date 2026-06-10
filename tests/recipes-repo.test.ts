/**
 * Recipe repository tests.
 *
 * The Prisma client is mocked — there is no database in CI. The pure mappers
 * (rowToRecipe, withRecipeId, normalizeUrl) are tested directly; repository
 * flows (upsert id retention, list summaries, delete) run against the mock.
 */

import type { Recipe } from "@/types";

jest.mock("@/lib/db/client", () => ({
  prisma: {
    recipe: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

import { prisma } from "@/lib/db/client";
import {
  deleteRecipe,
  listRecipes,
  normalizeUrl,
  rowToRecipe,
  upsertRecipeByUrl,
  withRecipeId,
} from "@/lib/db/recipes";

const mockRecipe = prisma.recipe as unknown as {
  findMany: jest.Mock;
  findUnique: jest.Mock;
  upsert: jest.Mock;
  delete: jest.Mock;
};

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  const id = overrides.id ?? "new-id";
  return {
    id,
    url: "https://example.com/recipe",
    title: "Test Recipe",
    base_servings: 4,
    parsed_at: "2026-06-10T00:00:00.000Z",
    cuisine_source: "western",
    ingredients: [
      {
        recipe_id: id,
        raw_text: "2 cloves garlic",
        quantity: 2,
        unit: null,
        name: "garlic",
        canonical_id: null,
      },
    ],
    instructions: ["Chop the garlic."],
    ...overrides,
  };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-id",
    url: "https://example.com/recipe",
    title: "Test Recipe",
    baseServings: 4,
    cuisineSource: "western",
    ingredients: [
      {
        recipe_id: "row-id",
        raw_text: "2 cloves garlic",
        quantity: 2,
        unit: null,
        name: "garlic",
        canonical_id: null,
      },
    ],
    instructions: ["Chop the garlic."],
    parsedAt: new Date("2026-06-10T00:00:00.000Z"),
    userId: null,
    createdAt: new Date("2026-06-10T01:00:00.000Z"),
    updatedAt: new Date("2026-06-10T01:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── rowToRecipe ──────────────────────────────────────────────────────────────

describe("rowToRecipe", () => {
  test("maps a full row to the Recipe document shape", () => {
    const recipe = rowToRecipe(makeRow() as never);
    expect(recipe).toEqual({
      id: "row-id",
      url: "https://example.com/recipe",
      title: "Test Recipe",
      base_servings: 4,
      parsed_at: "2026-06-10T00:00:00.000Z",
      cuisine_source: "western",
      ingredients: [
        {
          recipe_id: "row-id",
          raw_text: "2 cloves garlic",
          quantity: 2,
          unit: null,
          name: "garlic",
          canonical_id: null,
        },
      ],
      instructions: ["Chop the garlic."],
    });
  });

  test("tolerates non-array instructions (pre-feature rows) → []", () => {
    const recipe = rowToRecipe(makeRow({ instructions: null }) as never);
    expect(recipe.instructions).toEqual([]);
  });

  test("tolerates non-array ingredients → []", () => {
    const recipe = rowToRecipe(makeRow({ ingredients: null }) as never);
    expect(recipe.ingredients).toEqual([]);
  });

  test("unknown cuisine_source value falls back to 'unknown'", () => {
    const recipe = rowToRecipe(makeRow({ cuisineSource: "martian" }) as never);
    expect(recipe.cuisine_source).toBe("unknown");
  });
});

// ─── withRecipeId ─────────────────────────────────────────────────────────────

describe("withRecipeId", () => {
  test("rewrites recipe id and every embedded ingredient recipe_id", () => {
    const rewritten = withRecipeId(makeRecipe(), "surviving-id");
    expect(rewritten.id).toBe("surviving-id");
    for (const ing of rewritten.ingredients) {
      expect(ing.recipe_id).toBe("surviving-id");
    }
  });

  test("does not mutate the original recipe", () => {
    const original = makeRecipe();
    withRecipeId(original, "other");
    expect(original.id).toBe("new-id");
    expect(original.ingredients[0].recipe_id).toBe("new-id");
  });
});

// ─── normalizeUrl ─────────────────────────────────────────────────────────────

describe("normalizeUrl", () => {
  test("strips trailing slash", () => {
    expect(normalizeUrl("https://x.com/recipe/")).toBe("https://x.com/recipe");
  });

  test("strips tracking params but keeps meaningful ones", () => {
    expect(
      normalizeUrl("https://x.com/recipe?utm_source=fb&fbclid=123&page=2")
    ).toBe("https://x.com/recipe?page=2");
  });

  test("strips hash fragments", () => {
    expect(normalizeUrl("https://x.com/recipe#comments")).toBe(
      "https://x.com/recipe"
    );
  });

  test("returns invalid URLs unchanged", () => {
    expect(normalizeUrl("not a url")).toBe("not a url");
  });
});

// ─── upsertRecipeByUrl ────────────────────────────────────────────────────────

describe("upsertRecipeByUrl", () => {
  test("new URL → creates with the extracted recipe's id", async () => {
    mockRecipe.findUnique.mockResolvedValue(null);
    mockRecipe.upsert.mockImplementation(({ create }: { create: Record<string, unknown> }) =>
      Promise.resolve(makeRow({ ...create }))
    );

    const result = await upsertRecipeByUrl(makeRecipe({ id: "fresh-id" }));
    expect(mockRecipe.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { url: "https://example.com/recipe" },
        create: expect.objectContaining({ id: "fresh-id" }),
      })
    );
    expect(result.id).toBe("fresh-id");
  });

  test("existing URL → keeps the existing row's id, rewrites ingredient ids", async () => {
    mockRecipe.findUnique.mockResolvedValue(makeRow({ id: "old-id" }));
    mockRecipe.upsert.mockImplementation(
      ({ update }: { update: Record<string, unknown> }) =>
        Promise.resolve(makeRow({ id: "old-id", ...update }))
    );

    const result = await upsertRecipeByUrl(makeRecipe({ id: "fresh-id" }));
    expect(result.id).toBe("old-id");
    for (const ing of result.ingredients) {
      expect(ing.recipe_id).toBe("old-id");
    }
  });

  test("dedupes by normalized URL (trailing slash + utm)", async () => {
    mockRecipe.findUnique.mockResolvedValue(null);
    mockRecipe.upsert.mockImplementation(({ create }: { create: Record<string, unknown> }) =>
      Promise.resolve(makeRow({ ...create }))
    );

    await upsertRecipeByUrl(
      makeRecipe({ url: "https://example.com/recipe/?utm_source=x" })
    );
    expect(mockRecipe.findUnique).toHaveBeenCalledWith({
      where: { url: "https://example.com/recipe" },
    });
  });
});

// ─── listRecipes / deleteRecipe ───────────────────────────────────────────────

describe("listRecipes", () => {
  test("maps rows to summaries, newest first", async () => {
    mockRecipe.findMany.mockResolvedValue([makeRow()]);
    const summaries = await listRecipes();
    expect(mockRecipe.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
    });
    expect(summaries).toEqual([
      {
        id: "row-id",
        url: "https://example.com/recipe",
        title: "Test Recipe",
        base_servings: 4,
        ingredient_count: 1,
        has_instructions: true,
        created_at: "2026-06-10T01:00:00.000Z",
      },
    ]);
  });

  test("empty instructions → has_instructions false", async () => {
    mockRecipe.findMany.mockResolvedValue([makeRow({ instructions: [] })]);
    const [summary] = await listRecipes();
    expect(summary.has_instructions).toBe(false);
  });
});

describe("deleteRecipe", () => {
  test("returns true on success", async () => {
    mockRecipe.delete.mockResolvedValue(makeRow());
    expect(await deleteRecipe("row-id")).toBe(true);
  });

  test("returns false when the record does not exist", async () => {
    mockRecipe.delete.mockRejectedValue(new Error("P2025"));
    expect(await deleteRecipe("missing")).toBe(false);
  });
});
