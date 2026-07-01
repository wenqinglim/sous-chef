/**
 * Recipe repository tests.
 *
 * The Prisma client is mocked — there is no database in CI. The pure mappers
 * (rowToRecipe, withRecipeId, normalizeUrl) are tested directly; repository
 * flows (upsert id retention, list summaries, delete) run against the mock.
 */

import { Prisma } from "@prisma/client";
import type { Recipe } from "@/types";

jest.mock("@/lib/db/client", () => ({
  prisma: {
    recipe: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
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
  updateRecipe,
  upsertRecipeByUrl,
  withRecipeId,
} from "@/lib/db/recipes";

const mockRecipe = prisma.recipe as unknown as {
  findMany: jest.Mock;
  findUnique: jest.Mock;
  upsert: jest.Mock;
  update: jest.Mock;
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
    instructions: [{ text: "Chop the garlic.", section: null }],
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
    notes: null,
    edited: false,
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
      // Legacy string[] instructions in the row coerce to InstructionStep[].
      instructions: [{ text: "Chop the garlic.", section: null }],
      notes: null,
      edited: false,
    });
  });

  test("tolerates non-array instructions (pre-feature rows) → []", () => {
    const recipe = rowToRecipe(makeRow({ instructions: null }) as never);
    expect(recipe.instructions).toEqual([]);
  });

  test("coerces legacy string[] instructions into InstructionStep[]", () => {
    const recipe = rowToRecipe(
      makeRow({ instructions: ["Step one.", "Step two."] }) as never
    );
    expect(recipe.instructions).toEqual([
      { text: "Step one.", section: null },
      { text: "Step two.", section: null },
    ]);
  });

  test("preserves section labels on instructions and ingredients", () => {
    const recipe = rowToRecipe(
      makeRow({
        instructions: [{ text: "Whisk the sauce.", section: "Sauce" }],
        ingredients: [
          {
            recipe_id: "row-id",
            raw_text: "2 tbsp soy sauce",
            quantity: 2,
            unit: "tbsp",
            name: "soy sauce",
            canonical_id: null,
            section: "Sauce",
          },
        ],
      }) as never
    );
    expect(recipe.instructions).toEqual([
      { text: "Whisk the sauce.", section: "Sauce" },
    ]);
    expect(recipe.ingredients[0].section).toBe("Sauce");
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

  test("existing row is edited → skips the write, returns it untouched", async () => {
    mockRecipe.findUnique.mockResolvedValue(
      makeRow({ id: "old-id", edited: true, title: "My customized recipe" })
    );

    const result = await upsertRecipeByUrl(
      makeRecipe({ id: "fresh-id", title: "Re-extracted title" })
    );

    expect(mockRecipe.upsert).not.toHaveBeenCalled();
    expect(result.id).toBe("old-id");
    expect(result.title).toBe("My customized recipe");
    expect(result.edited).toBe(true);
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

// ─── updateRecipe ─────────────────────────────────────────────────────────────

describe("updateRecipe", () => {
  test("persists the patch and flags the row as edited", async () => {
    mockRecipe.update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(
          makeRow({
            id: "row-id",
            title: (data.title as string) ?? "Test Recipe",
            notes: (data.notes as string) ?? null,
            edited: data.edited as boolean,
          })
        )
    );

    const result = await updateRecipe("row-id", {
      title: "Edited title",
      notes: "extra chili",
    });

    expect(mockRecipe.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "row-id" },
        data: expect.objectContaining({
          edited: true,
          title: "Edited title",
          notes: "extra chili",
        }),
      })
    );
    expect(result?.edited).toBe(true);
    expect(result?.title).toBe("Edited title");
  });

  test("rewrites embedded ingredient recipe_id to the row id", async () => {
    mockRecipe.update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(makeRow({ id: "row-id", ingredients: data.ingredients }))
    );

    const result = await updateRecipe("row-id", {
      ingredients: [
        {
          recipe_id: "stale-id",
          raw_text: "1 onion",
          quantity: 1,
          unit: null,
          name: "onion",
          canonical_id: null,
        },
      ],
    });

    expect(result?.ingredients[0].recipe_id).toBe("row-id");
  });

  test("round-trips section labels on ingredients and instructions", async () => {
    mockRecipe.update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(
          makeRow({
            id: "row-id",
            ingredients: data.ingredients,
            instructions: data.instructions,
          })
        )
    );

    const result = await updateRecipe("row-id", {
      ingredients: [
        {
          recipe_id: "row-id",
          raw_text: "2 tbsp soy sauce",
          quantity: 2,
          unit: "tbsp",
          name: "soy sauce",
          canonical_id: null,
          section: "Sauce",
        },
      ],
      instructions: [{ text: "Whisk the sauce.", section: "Sauce" }],
    });

    expect(result?.ingredients[0].section).toBe("Sauce");
    expect(result?.instructions).toEqual([
      { text: "Whisk the sauce.", section: "Sauce" },
    ]);
  });

  test("returns null when the record does not exist (P2025)", async () => {
    mockRecipe.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Record not found", {
        code: "P2025",
        clientVersion: "6.0.0",
      })
    );
    expect(await updateRecipe("missing", { title: "x" })).toBeNull();
  });

  test("propagates non-P2025 errors", async () => {
    mockRecipe.update.mockRejectedValue(new Error("connection refused"));
    await expect(updateRecipe("row-id", { title: "x" })).rejects.toThrow(
      "connection refused"
    );
  });
});

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
        edited: false,
        has_notes: false,
        created_at: "2026-06-10T01:00:00.000Z",
      },
    ]);
  });

  test("empty instructions → has_instructions false", async () => {
    mockRecipe.findMany.mockResolvedValue([makeRow({ instructions: [] })]);
    const [summary] = await listRecipes();
    expect(summary.has_instructions).toBe(false);
  });

  test("edited row with notes → edited / has_notes true", async () => {
    mockRecipe.findMany.mockResolvedValue([
      makeRow({ edited: true, notes: "  add chili  " }),
    ]);
    const [summary] = await listRecipes();
    expect(summary.edited).toBe(true);
    expect(summary.has_notes).toBe(true);
  });

  test("whitespace-only notes → has_notes false", async () => {
    mockRecipe.findMany.mockResolvedValue([makeRow({ notes: "   " })]);
    const [summary] = await listRecipes();
    expect(summary.has_notes).toBe(false);
  });
});

describe("deleteRecipe", () => {
  test("returns true on success", async () => {
    mockRecipe.delete.mockResolvedValue(makeRow());
    expect(await deleteRecipe("row-id")).toBe(true);
  });

  test("returns false when the record does not exist (P2025)", async () => {
    mockRecipe.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Record not found", {
        code: "P2025",
        clientVersion: "6.0.0",
      })
    );
    expect(await deleteRecipe("missing")).toBe(false);
  });

  test("propagates non-P2025 errors (connection failures are not 404s)", async () => {
    mockRecipe.delete.mockRejectedValue(new Error("connection refused"));
    await expect(deleteRecipe("row-id")).rejects.toThrow("connection refused");
  });
});
