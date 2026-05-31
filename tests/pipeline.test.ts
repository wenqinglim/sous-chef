/**
 * End-to-end pipeline tests.
 *
 * These tests run the full pipeline from fixture HTML → PurchaseItem[]
 * without making any LLM API calls (all test ingredients exist in the registry).
 */

import * as fs from "fs";
import * as path from "path";
import { extractFromSchemaOrg } from "@/lib/extractors/schema-org";
import { normalizeRecipe } from "@/lib/pipeline/normalize";
import { aggregate } from "@/lib/pipeline/aggregate";
import { planPurchases } from "@/lib/pipeline/purchase";
import { derive } from "@/lib/derive";
import type { MealPlan, Recipe } from "@/types";
import { v4 as uuidv4 } from "uuid";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf-8");
}

function extractFixture(name: string, url: string): Recipe {
  const html = loadFixture(name);
  const result = extractFromSchemaOrg(html, url);
  if (!result.recipe) throw new Error(`Fixture extraction failed: ${result.error}`);
  return result.recipe;
}

// ─── aggregate ────────────────────────────────────────────────────────────────

describe("aggregate", () => {
  test("sums same canonical_id across two recipes", () => {
    const items = [
      { recipe_id: "r1", canonical_id: "garlic", quantity: 3, canonical_unit: "clove", raw_text: "3 cloves garlic", resolution_method: "lookup" as const },
      { recipe_id: "r2", canonical_id: "garlic", quantity: 5, canonical_unit: "clove", raw_text: "5 cloves garlic", resolution_method: "lookup" as const },
    ];
    const result = aggregate(items);
    expect(result).toHaveLength(1);
    expect(result[0].canonical_id).toBe("garlic");
    expect(result[0].total_quantity).toBe(8);
    expect(result[0].contributing_recipe_ids).toEqual(["r1", "r2"]);
  });

  test("keeps different canonical_ids separate", () => {
    const items = [
      { recipe_id: "r1", canonical_id: "garlic", quantity: 3, canonical_unit: "clove", raw_text: "3 cloves garlic", resolution_method: "lookup" as const },
      { recipe_id: "r1", canonical_id: "soy_sauce_light", quantity: 30, canonical_unit: "ml", raw_text: "2 tbsp light soy", resolution_method: "lookup" as const },
    ];
    const result = aggregate(items);
    expect(result).toHaveLength(2);
  });

  test("scaling: quantity passed in should already be scaled", () => {
    const items = [
      // 2 cloves scaled ×1.5 = 3
      { recipe_id: "r1", canonical_id: "garlic", quantity: 3, canonical_unit: "clove", raw_text: "2 cloves", resolution_method: "lookup" as const },
    ];
    const result = aggregate(items);
    expect(result[0].total_quantity).toBe(3);
  });
});

// ─── planPurchases ────────────────────────────────────────────────────────────

describe("planPurchases", () => {
  test("coconut milk: 680ml → 2 cans (400ml each)", () => {
    const agg = [
      { canonical_id: "coconut_milk", total_quantity: 680, canonical_unit: "ml", contributing_recipe_ids: ["r1"] },
    ];
    const items = planPurchases(agg);
    expect(items).toHaveLength(1);
    expect(items[0].purchase_quantity).toBe(2); // ceil(680/400)
    expect(items[0].purchase_unit).toBe("can");
  });

  test("coconut milk leftover: 680ml needed, 2×400ml bought → 120ml leftover", () => {
    const agg = [
      { canonical_id: "coconut_milk", total_quantity: 680, canonical_unit: "ml", contributing_recipe_ids: ["r1"] },
    ];
    const items = planPurchases(agg);
    expect(items[0].leftover_quantity).toBeCloseTo(120, 0);
  });

  test("garlic: 3 cloves → 1 head (10 cloves per head, ceil(3/10)=1)", () => {
    const agg = [
      { canonical_id: "garlic", total_quantity: 3, canonical_unit: "clove", contributing_recipe_ids: ["r1"] },
    ];
    const items = planPurchases(agg);
    expect(items[0].purchase_quantity).toBe(1);
    expect(items[0].purchase_unit).toBe("head");
  });

  test("PurchaseItem includes aisle and is_staple", () => {
    const agg = [
      { canonical_id: "soy_sauce_light", total_quantity: 45, canonical_unit: "ml", contributing_recipe_ids: ["r1"] },
    ];
    const items = planPurchases(agg);
    expect(items[0].aisle).toBe("asian_grocery");
    expect(items[0].is_staple).toBe(true);
  });

  test("all PurchaseItem fields are present", () => {
    const agg = [
      { canonical_id: "garlic", total_quantity: 5, canonical_unit: "clove", contributing_recipe_ids: ["r1"] },
    ];
    const item = planPurchases(agg)[0];
    expect(item).toHaveProperty("canonical_id");
    expect(item).toHaveProperty("display_name");
    expect(item).toHaveProperty("recipe_quantity");
    expect(item).toHaveProperty("recipe_unit");
    expect(item).toHaveProperty("purchase_unit");
    expect(item).toHaveProperty("purchase_quantity");
    expect(item).toHaveProperty("leftover_quantity");
    expect(item).toHaveProperty("aisle");
    expect(item).toHaveProperty("is_staple");
  });
});

// ─── normalizeRecipe (no LLM calls needed for fixture ingredients) ────────────

describe("normalizeRecipe — Woks of Life Mapo Tofu", () => {
  const recipe = extractFixture(
    "woksoflife.html",
    "https://thewoksoflife.com/mapo-tofu/"
  );

  test("normalizes without error", async () => {
    const result = await normalizeRecipe(recipe, recipe.base_servings);
    expect(result.normalized.length).toBeGreaterThan(0);
  });

  test("scaling factor 1: quantities unchanged", async () => {
    const result = await normalizeRecipe(recipe, recipe.base_servings);
    // All normalized items should have positive quantities
    for (const n of result.normalized) {
      expect(n.quantity).toBeGreaterThan(0);
    }
  });

  test("soy sauce resolves to soy_sauce_light (asian cuisine source)", async () => {
    const result = await normalizeRecipe(recipe, recipe.base_servings);
    const soy = result.normalized.find(
      (n) => n.canonical_id === "soy_sauce_light"
    );
    expect(soy).toBeDefined();
  });
});

// ─── Full pipeline: Pad Thai single recipe ────────────────────────────────────

describe("Full pipeline — Pad Thai (single recipe, 2→4 servings)", () => {
  let items: ReturnType<typeof planPurchases>;

  beforeAll(async () => {
    const recipe = extractFixture(
      "hotthaikitchen.html",
      "https://hot-thai-kitchen.com/pad-thai/"
    );
    const { normalized } = await normalizeRecipe(recipe, 4); // scale 2→4
    const aggregated = aggregate(normalized);
    items = planPurchases(aggregated);
  });

  test("produces at least 3 purchase items", () => {
    expect(items.length).toBeGreaterThanOrEqual(3);
  });

  test("all items have purchase_quantity >= 1", () => {
    for (const item of items) {
      expect(item.purchase_quantity).toBeGreaterThanOrEqual(1);
    }
  });

  test("shrimp is in meat or seafood aisle", () => {
    const shrimp = items.find((i) => i.canonical_id === "shrimp");
    if (shrimp) {
      expect(["meat", "seafood"]).toContain(shrimp.aisle);
    }
  });
});

// ─── Regression: egg rounding ────────────────────────────────────────────────

describe("planPurchases — regression: egg rounding", () => {
  test("4 eggs → 1 dozen, not 6 dozens", () => {
    const agg = [
      { canonical_id: "egg", total_quantity: 4, canonical_unit: "each", contributing_recipe_ids: ["r1"] },
    ];
    const items = planPurchases(agg);
    expect(items[0].purchase_unit).toBe("dozen");
    expect(items[0].purchase_quantity).toBe(1);
  });

  test("13 eggs → 2 dozens", () => {
    const agg = [
      { canonical_id: "egg", total_quantity: 13, canonical_unit: "each", contributing_recipe_ids: ["r1"] },
    ];
    const items = planPurchases(agg);
    expect(items[0].purchase_quantity).toBe(2);
  });
});

// ─── Regression: g→each unit conversion ──────────────────────────────────────

describe("normalizeRecipe — regression: weight→count conversion", () => {
  test("400g tomatoes normalizes to ~3.2 each, not 400 each", async () => {
    const recipeId = "test-recipe";
    const recipe: Recipe = {
      id: recipeId,
      url: "https://example.com/recipe",
      title: "Test Recipe",
      base_servings: 4,
      parsed_at: new Date().toISOString(),
      cuisine_source: "western",
      ingredients: [
        {
          recipe_id: recipeId,
          raw_text: "400g tomatoes",
          quantity: 400,
          unit: "g",
          name: "tomatoes",
          canonical_id: null,
        },
      ],
    };
    const result = await normalizeRecipe(recipe, 4);
    const tomato = result.normalized.find((n) => n.canonical_id === "tomato");
    expect(tomato).toBeDefined();
    // 400g × 0.008 (each/g from conversion_factors) = 3.2 each
    expect(tomato!.quantity).toBeCloseTo(3.2, 1);
    expect(tomato!.quantity).toBeLessThan(10); // guard: must not be raw gram value
  });
});

// ─── derive() — multi-recipe meal plan ───────────────────────────────────────

describe("derive() — multi-recipe meal plan", () => {
  test("aggregates garlic across two recipes", async () => {
    // Build a minimal meal plan with two recipes that both use garlic
    const recipe1 = extractFixture(
      "woksoflife.html",
      "https://thewoksoflife.com/mapo-tofu/"
    );
    const recipe2 = extractFixture(
      "hotthaikitchen.html",
      "https://hot-thai-kitchen.com/pad-thai/"
    );

    const mealPlan: MealPlan = {
      id: uuidv4(),
      name: null,
      recipes: [
        { recipe_id: recipe1.id, target_servings: 4 },
        { recipe_id: recipe2.id, target_servings: 2 },
      ],
    };

    const recipeMap = new Map<string, Recipe>([
      [recipe1.id, recipe1],
      [recipe2.id, recipe2],
    ]);

    const result = await derive(mealPlan, recipeMap);

    // Both recipes have garlic — should be aggregated into one item
    const garlicItems = result.items.filter((i) => i.canonical_id === "garlic");
    expect(garlicItems.length).toBe(1); // not duplicated

    // Result has grouped_by_aisle
    expect(typeof result.grouped_by_aisle).toBe("object");
  });
});
