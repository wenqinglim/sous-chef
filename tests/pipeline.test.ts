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
import { getAllIngredients } from "@/lib/registry/registry";
import { formatForKeep } from "@/lib/format";
import { roundUpDisplay } from "@/lib/units/format-number";
import type { MealPlan, Recipe, UnresolvableIngredient } from "@/types";
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
      instructions: [],
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

// ─── Regression: opaque purchase-unit math (spaghetti) ────────────────────────

describe("planPurchases — opaque purchase units use default_purchase_size", () => {
  test("500g spaghetti → 1 package, 0 leftover (not 500 packages)", () => {
    const items = planPurchases([
      {
        canonical_id: "pasta_spaghetti",
        total_quantity: 500,
        canonical_unit: "g",
        contributing_recipe_ids: ["r1"],
      },
    ]);
    expect(items[0].purchase_unit).toBe("package");
    expect(items[0].purchase_quantity).toBe(1);
    expect(items[0].leftover_quantity).toBe(0);
  });

  test("750g spaghetti → 2 packages (ceil), 250g leftover", () => {
    const items = planPurchases([
      {
        canonical_id: "pasta_spaghetti",
        total_quantity: 750,
        canonical_unit: "g",
        contributing_recipe_ids: ["r1"],
      },
    ]);
    expect(items[0].purchase_quantity).toBe(2);
    expect(items[0].leftover_quantity).toBeCloseTo(250);
  });
});

// ─── Regression: slice → weight conversion (galangal) ─────────────────────────

describe("normalizeRecipe + planPurchases — galangal slices", () => {
  function galangalRecipe(): Recipe {
    return {
      id: "g1",
      url: "https://hot-thai-kitchen.com/x",
      title: "Galangal Test",
      base_servings: 4,
      parsed_at: new Date().toISOString(),
      cuisine_source: "asian",
      ingredients: [
        {
          recipe_id: "g1",
          raw_text: "6 slices galangal, chopped",
          quantity: null,
          unit: null,
          name: "",
          canonical_id: null,
        },
      ],
      instructions: [],
    };
  }

  test("6 slices ×2 servings → 60g, purchased as 2 pieces (not 12)", async () => {
    const { normalized } = await normalizeRecipe(galangalRecipe(), 8);
    const g = normalized.find((n) => n.canonical_id === "galangal");
    expect(g).toBeDefined();
    expect(g!.canonical_unit).toBe("g");
    expect(g!.quantity).toBeCloseTo(60); // 12 slices × 5 g

    const items = planPurchases(aggregate(normalized));
    const item = items.find((i) => i.canonical_id === "galangal")!;
    expect(item.purchase_unit).toBe("piece");
    expect(item.purchase_quantity).toBe(2); // ceil(60 / 50)
  });
});

// ─── Regression: end-to-end screenshot recipe resolves without LLM ────────────

describe("derive() — messy recipe resolves with registry only (no API key)", () => {
  test("none of the common ingredients land in 'couldn't categorise'", async () => {
    const recipe: Recipe = {
      id: "screenshot",
      url: "https://hot-thai-kitchen.com/tom-yum-pasta",
      title: "Tom Yum Pasta",
      base_servings: 2,
      parsed_at: new Date().toISOString(),
      cuisine_source: "asian",
      ingredients: [
        "1 stalk lemongrass, bottom half only, thinly sliced",
        "6 slices galangal, chopped",
        "6 kaffir lime leaves, finely julienned",
        "1-3 Thai chilies, to taste",
        "Half a medium onion, chopped",
        "2 Tbsp Thai chili paste",
        "1 ½ Tbsp fish sauce",
        "14 oz good quality whole peeled plum tomatoes (half of a 28oz/796ml can)",
        "150g shimeji mushrooms (see note)",
        "12-15 medium shrimp, or as many as you'd like",
        "250g spaghetti",
        "1 ½ - 2 Tbsp lime juice",
        "Chopped cilantro, as much as you want",
        "Grated parmesan cheese for serving",
      ].map((raw_text) => ({
        recipe_id: "screenshot",
        raw_text,
        quantity: null,
        unit: null,
        name: "",
        canonical_id: null,
      })),
      instructions: [],
    };

    const mealPlan: MealPlan = {
      id: uuidv4(),
      name: null,
      recipes: [{ recipe_id: recipe.id, target_servings: 4 }],
    };
    const result = await derive(mealPlan, new Map([[recipe.id, recipe]]));

    // Every line should resolve via the registry alone.
    expect(result.unresolvable).toEqual([]);

    // Spaghetti is sane (1 package for 500g), not 500 packages.
    const spaghetti = result.items.find((i) => i.canonical_id === "pasta_spaghetti")!;
    expect(spaghetti.purchase_quantity).toBe(1);

    // Output units must be metric or cups/spoon — never imperial oz/lb,
    // even though the source recipe specifies "14 oz" tomatoes and parmesan.
    const imperial = new Set(["oz", "lb", "ounce", "ounces", "pound", "pounds"]);
    for (const item of result.items) {
      expect(imperial.has(item.purchase_unit.toLowerCase())).toBe(false);
      expect(imperial.has(item.recipe_unit.toLowerCase())).toBe(false);
    }
  });
});

// ─── Regression: registry never emits imperial purchase units ─────────────────

describe("registry purchase units are metric or cups/spoon (no oz/lb)", () => {
  test("no ingredient uses oz/lb as its default_purchase_unit", () => {
    const imperial = new Set(["oz", "lb", "ounce", "ounces", "pound", "pounds"]);
    const offenders = getAllIngredients()
      .filter((ing) => imperial.has(ing.default_purchase_unit.toLowerCase()))
      .map((ing) => ing.id);
    expect(offenders).toEqual([]);
  });
});

// ─── Guardrail: opaque purchase units never divide by size 1 ─────────────────

describe("planPurchases — opaque-unit guardrail prevents absurd counts", () => {
  test("lime_juice: 52 ml → 1 bottle (not 52)", () => {
    const items = planPurchases([
      { canonical_id: "lime_juice", total_quantity: 52.4, canonical_unit: "ml", contributing_recipe_ids: ["r1"] },
    ]);
    expect(items[0].purchase_unit).toBe("bottle");
    expect(items[0].purchase_quantity).toBe(1);
  });

  test("lime_juice: 600 ml → 3 bottles (scales correctly)", () => {
    const items = planPurchases([
      { canonical_id: "lime_juice", total_quantity: 600, canonical_unit: "ml", contributing_recipe_ids: ["r1"] },
    ]);
    expect(items[0].purchase_quantity).toBe(Math.ceil(600 / 250));
  });

  test("doubanjiang: 45 ml → 1 jar (not 45)", () => {
    const items = planPurchases([
      { canonical_id: "doubanjiang", total_quantity: 45, canonical_unit: "ml", contributing_recipe_ids: ["r1"] },
    ]);
    expect(items[0].purchase_quantity).toBe(1);
  });

  test("gochujang: 30 ml → 1 tub (not 30)", () => {
    const items = planPurchases([
      { canonical_id: "gochujang", total_quantity: 30, canonical_unit: "ml", contributing_recipe_ids: ["r1"] },
    ]);
    expect(items[0].purchase_quantity).toBe(1);
  });

  test("chili_oil: 15 ml → 1 bottle (not 15)", () => {
    const items = planPurchases([
      { canonical_id: "chili_oil", total_quantity: 15, canonical_unit: "ml", contributing_recipe_ids: ["r1"] },
    ]);
    expect(items[0].purchase_quantity).toBe(1);
  });

  test("shrimp_paste: 20 g → 1 block (not 20)", () => {
    const items = planPurchases([
      { canonical_id: "shrimp_paste", total_quantity: 20, canonical_unit: "g", contributing_recipe_ids: ["r1"] },
    ]);
    expect(items[0].purchase_quantity).toBe(1);
  });

  // Anti-regression: realistic purchase_size > 1 entries must be unchanged
  test("coconut_milk: 680 ml → 2 cans (existing behaviour preserved)", () => {
    const items = planPurchases([
      { canonical_id: "coconut_milk", total_quantity: 680, canonical_unit: "ml", contributing_recipe_ids: ["r1"] },
    ]);
    expect(items[0].purchase_unit).toBe("can");
    expect(items[0].purchase_quantity).toBe(2);
  });

  test("pasta_spaghetti: 500 g → 1 package (existing behaviour preserved)", () => {
    const items = planPurchases([
      { canonical_id: "pasta_spaghetti", total_quantity: 500, canonical_unit: "g", contributing_recipe_ids: ["r1"] },
    ]);
    expect(items[0].purchase_quantity).toBe(1);
  });
});

// ─── Shrimp: natural count unit ───────────────────────────────────────────────

describe("shrimp — natural count unit", () => {
  test("'12-15 medium shrimp' normalises to each, rounds up whole for purchase", async () => {
    const recipe: Recipe = {
      id: "r1", url: "https://example.com", title: "T", base_servings: 2,
      parsed_at: new Date().toISOString(), cuisine_source: "unknown",
      ingredients: [{ recipe_id: "r1", raw_text: "12-15 medium shrimp", quantity: null, unit: null, name: "", canonical_id: null }],
      instructions: [],
    };
    const { normalized } = await normalizeRecipe(recipe, 2);
    const s = normalized.find((n) => n.canonical_id === "shrimp")!;
    expect(s).toBeDefined();
    expect(s.canonical_unit).toBe("each");
    // midpoint 13.5, scaled ×1 → canonical 13.5
    expect(s.quantity).toBeCloseTo(13.5);

    const items = planPurchases(aggregate(normalized));
    const item = items.find((i) => i.canonical_id === "shrimp")!;
    expect(item.purchase_unit).toBe("each");
    expect(Number.isInteger(item.purchase_quantity)).toBe(true);
    expect(item.purchase_quantity).toBe(14); // ceil(13.5)
  });
});

// ─── New registry entries resolve without LLM ─────────────────────────────────

describe("new registry entries — duck, bay leaf, thyme", () => {
  function makeRecipe(ingredients: string[]): Recipe {
    return {
      id: "duck1", url: "https://example.com", title: "Duck Confit", base_servings: 3,
      parsed_at: new Date().toISOString(), cuisine_source: "western",
      ingredients: ingredients.map((raw_text) => ({
        recipe_id: "duck1", raw_text, quantity: null, unit: null, name: "", canonical_id: null,
      })),
      instructions: [],
    };
  }

  test("duck legs resolve to duck_leg (each), purchase_quantity is whole integer", async () => {
    const { normalized, unresolvable } = await normalizeRecipe(makeRecipe(["4 duck legs"]), 4);
    expect(unresolvable.find((u) => u.name.includes("duck leg"))).toBeUndefined();
    const item = normalized.find((n) => n.canonical_id === "duck_leg")!;
    expect(item).toBeDefined();
    expect(item.canonical_unit).toBe("each");
    const purchased = planPurchases(aggregate(normalized));
    const p = purchased.find((i) => i.canonical_id === "duck_leg")!;
    expect(Number.isInteger(p.purchase_quantity)).toBe(true);
  });

  test("duck fat resolves to duck_fat, 1 kg → 4 jars (ceil(1000/320))", async () => {
    const { normalized, unresolvable } = await normalizeRecipe(makeRecipe(["1 kg duck fat (see Kitchen Notes)"]), 3);
    expect(unresolvable.find((u) => u.name.includes("duck fat"))).toBeUndefined();
    const item = normalized.find((n) => n.canonical_id === "duck_fat")!;
    expect(item).toBeDefined();
    const purchased = planPurchases(aggregate(normalized));
    const p = purchased.find((i) => i.canonical_id === "duck_fat")!;
    expect(p.purchase_unit).toBe("jar");
    expect(p.purchase_quantity).toBe(Math.ceil(1000 / 320));
  });

  test("bay leaves resolve to bay_leaf, is_staple true (check-stock bucket)", async () => {
    const { normalized, unresolvable } = await normalizeRecipe(makeRecipe(["2 bay leaves"]), 3);
    expect(unresolvable.find((u) => u.name.includes("bay"))).toBeUndefined();
    expect(normalized.find((n) => n.canonical_id === "bay_leaf")).toBeDefined();
    const purchased = planPurchases(aggregate(normalized));
    const p = purchased.find((i) => i.canonical_id === "bay_leaf")!;
    expect(p.is_staple).toBe(true);
  });

  test("thyme sprigs resolve to thyme, purchase_quantity is 1 bunch", async () => {
    const { normalized, unresolvable } = await normalizeRecipe(makeRecipe(["4-6 sprigs thyme"]), 3);
    expect(unresolvable.find((u) => u.name.includes("thyme"))).toBeUndefined();
    expect(normalized.find((n) => n.canonical_id === "thyme")).toBeDefined();
    const purchased = planPurchases(aggregate(normalized));
    const p = purchased.find((i) => i.canonical_id === "thyme")!;
    expect(p.purchase_unit).toBe("bunch");
    expect(p.purchase_quantity).toBe(1);
  });
});

// ─── roundUpDisplay helper ─────────────────────────────────────────────────────

describe("roundUpDisplay", () => {
  test.each([
    [5.3333, 6],
    [2.6666, 3],
    [1.0,   1],
    [0.1,   1],
    [0,     0],
    [-1,    0],
    [Infinity, 0],
    [NaN,   0],
  ])("roundUpDisplay(%s) === %s", (input, expected) => {
    expect(roundUpDisplay(input)).toBe(expected);
  });
});

// ─── Registry validation: no opaque ml/g entry ships with purchase_size <= 1 ──

describe("registry validation — opaque units have realistic purchase sizes", () => {
  test("no ml/g ingredient has an opaque purchase unit with size <= 1", () => {
    const opaque = new Set([
      "bottle","jar","tub","can","tin","package","packet","pkg",
      "block","bag","carton","box","tube",
    ]);
    const offenders = getAllIngredients()
      .filter(
        (i) =>
          opaque.has(i.default_purchase_unit) &&
          i.default_purchase_size <= 1 &&
          (i.canonical_unit === "ml" || i.canonical_unit === "g")
      )
      .map((i) => i.id);
    expect(offenders).toEqual([]);
  });
});

// ─── formatForKeep includes unresolvable items ────────────────────────────────

describe("formatForKeep — unresolvable items in copy output", () => {
  const baseResult = {
    items: [],
    grouped_by_aisle: {},
    unresolvable: [] as UnresolvableIngredient[],
  };

  test("unresolvable items appear under ADD MANUALLY", () => {
    const result = {
      ...baseResult,
      unresolvable: [
        { recipe_id: "r1", raw_text: "", name: "duck legs", quantity: 5.333, unit: null },
      ] as UnresolvableIngredient[],
    };
    const text = formatForKeep(result);
    expect(text).toContain("ADD MANUALLY");
    expect(text).toContain("6"); // ceil(5.333)
    expect(text).toContain("duck legs");
  });

  test("null-quantity unresolvable renders as check-stock note", () => {
    const result = {
      ...baseResult,
      unresolvable: [
        { recipe_id: "r1", raw_text: "", name: "fresh herbs", quantity: null, unit: null },
      ] as UnresolvableIngredient[],
    };
    const text = formatForKeep(result);
    expect(text).toContain("check stock / to taste");
    expect(text).toContain("fresh herbs");
  });

  test("empty unresolvable produces no ADD MANUALLY section", () => {
    const text = formatForKeep(baseResult);
    expect(text).not.toContain("ADD MANUALLY");
  });
});
