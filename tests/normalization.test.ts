import {
  findById,
  findByAlias,
  getAllIngredients,
  detectAliasCollisions,
} from "@/lib/registry/registry";
import { lookupIngredient, inferCuisineSource } from "@/lib/normalizers/lookup";

// ─── Registry integrity ───────────────────────────────────────────────────────

describe("Registry integrity", () => {
  test("loads without error and has entries", () => {
    const all = getAllIngredients();
    expect(all.length).toBeGreaterThan(50);
  });

  test("every entry has required fields", () => {
    const all = getAllIngredients();
    for (const ing of all) {
      expect(ing.id).toBeTruthy();
      expect(ing.name).toBeTruthy();
      expect(Array.isArray(ing.aliases)).toBe(true);
      expect(ing.aisle).toBeTruthy();
      expect(ing.default_purchase_unit).toBeTruthy();
      expect(typeof ing.default_purchase_size).toBe("number");
      expect(typeof ing.is_staple).toBe("boolean");
      expect(ing.canonical_unit).toBeTruthy();
      expect(typeof ing.conversion_factors).toBe("object");
    }
  });

  test("no duplicate IDs", () => {
    const all = getAllIngredients();
    const ids = all.map((i) => i.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  test("no alias collisions across entries", () => {
    const collisions = detectAliasCollisions();
    expect(collisions).toEqual([]);
  });
});

// ─── findById ─────────────────────────────────────────────────────────────────

describe("findById", () => {
  test("finds garlic by id", () => {
    const ing = findById("garlic");
    expect(ing).not.toBeNull();
    expect(ing!.name).toBe("Garlic");
  });

  test("finds soy_sauce_light by id", () => {
    const ing = findById("soy_sauce_light");
    expect(ing).not.toBeNull();
  });

  test("returns null for unknown id", () => {
    expect(findById("___unknown___")).toBeNull();
  });
});

// ─── findByAlias ──────────────────────────────────────────────────────────────

describe("findByAlias — produce", () => {
  test('"scallions" → scallions', () => {
    const ing = findByAlias("scallions");
    expect(ing?.id).toBe("scallions");
  });

  test('"green onions" → scallions', () => {
    const ing = findByAlias("green onions");
    expect(ing?.id).toBe("scallions");
  });

  test('"spring onions" → scallions', () => {
    const ing = findByAlias("spring onions");
    expect(ing?.id).toBe("scallions");
  });

  test('"garlic cloves" → garlic', () => {
    const ing = findByAlias("garlic cloves");
    expect(ing?.id).toBe("garlic");
  });

  test('"fresh ginger" → ginger_fresh', () => {
    const ing = findByAlias("fresh ginger");
    expect(ing?.id).toBe("ginger_fresh");
  });

  test('"ginger root" → ginger_fresh', () => {
    const ing = findByAlias("ginger root");
    expect(ing?.id).toBe("ginger_fresh");
  });
});

describe("findByAlias — Asian sauces", () => {
  test('"light soy sauce" → soy_sauce_light', () => {
    const ing = findByAlias("light soy sauce");
    expect(ing?.id).toBe("soy_sauce_light");
  });

  test('"dark soy sauce" → dark_soy_sauce', () => {
    const ing = findByAlias("dark soy sauce");
    expect(ing?.id).toBe("dark_soy_sauce");
  });

  test('"oyster sauce" → oyster_sauce', () => {
    const ing = findByAlias("oyster sauce");
    expect(ing?.id).toBe("oyster_sauce");
  });

  test('"fish sauce" → fish_sauce', () => {
    const ing = findByAlias("fish sauce");
    expect(ing?.id).toBe("fish_sauce");
  });

  test('"nam pla" → fish_sauce', () => {
    const ing = findByAlias("nam pla");
    expect(ing?.id).toBe("fish_sauce");
  });

  test('"shaoxing wine" → shaoxing_wine', () => {
    const ing = findByAlias("shaoxing wine");
    expect(ing?.id).toBe("shaoxing_wine");
  });

  test('"shao hsing wine" → shaoxing_wine', () => {
    const ing = findByAlias("shao hsing wine");
    expect(ing?.id).toBe("shaoxing_wine");
  });

  test('"chinese cooking wine" → shaoxing_wine', () => {
    const ing = findByAlias("chinese cooking wine");
    expect(ing?.id).toBe("shaoxing_wine");
  });

  test('"sesame oil" → sesame_oil', () => {
    const ing = findByAlias("sesame oil");
    expect(ing?.id).toBe("sesame_oil");
  });

  test('"doubanjiang" → doubanjiang', () => {
    const ing = findByAlias("doubanjiang");
    expect(ing?.id).toBe("doubanjiang");
  });

  test('"spicy bean paste" → doubanjiang', () => {
    const ing = findByAlias("spicy bean paste");
    expect(ing?.id).toBe("doubanjiang");
  });

  test('"sambal oelek" → sambal_oelek', () => {
    const ing = findByAlias("sambal oelek");
    expect(ing?.id).toBe("sambal_oelek");
  });

  test('"sambal ulek" → sambal_oelek', () => {
    const ing = findByAlias("sambal ulek");
    expect(ing?.id).toBe("sambal_oelek");
  });
});

describe("findByAlias — case insensitivity", () => {
  test("GARLIC → garlic", () => {
    expect(findByAlias("GARLIC")?.id).toBe("garlic");
  });

  test("Shaoxing Wine → shaoxing_wine", () => {
    expect(findByAlias("Shaoxing Wine")?.id).toBe("shaoxing_wine");
  });
});

describe("findByAlias — unknown ingredient", () => {
  test("unknown returns null", () => {
    expect(findByAlias("___not_an_ingredient___")).toBeNull();
  });
});

// ─── Aisle taxonomy ──────────────────────────────────────────────────────────

describe("Aisle tagging", () => {
  const VALID_AISLES = new Set([
    "produce",
    "meat",
    "seafood",
    "dairy",
    "deli",
    "bakery",
    "frozen",
    "asian_grocery",
    "pantry",
    "condiments",
    "beverages",
    "other",
  ]);

  test("all aisles are from valid taxonomy", () => {
    for (const ing of getAllIngredients()) {
      expect(VALID_AISLES.has(ing.aisle)).toBe(true);
    }
  });

  test("soy_sauce_light is asian_grocery", () => {
    expect(findById("soy_sauce_light")?.aisle).toBe("asian_grocery");
  });

  test("garlic is produce", () => {
    expect(findById("garlic")?.aisle).toBe("produce");
  });

  test("egg is dairy", () => {
    expect(findById("egg")?.aisle).toBe("dairy");
  });
});

// ─── lookupIngredient ─────────────────────────────────────────────────────────

describe("lookupIngredient — direct", () => {
  test("garlic cloves → garlic", () => {
    const r = lookupIngredient("garlic cloves");
    expect(r.canonical_id).toBe("garlic");
    expect(r.method).toBe("lookup");
  });

  test("green onions → scallions", () => {
    expect(lookupIngredient("green onions").canonical_id).toBe("scallions");
  });

  test("fish sauce → fish_sauce", () => {
    expect(lookupIngredient("fish sauce").canonical_id).toBe("fish_sauce");
  });
});

describe("lookupIngredient — parenthetical stripping", () => {
  test("native-script paren: 'ginger (生姜)' → ginger_fresh", () => {
    expect(lookupIngredient("ginger (生姜)").canonical_id).toBe("ginger_fresh");
  });

  test("prep-note paren: 'garlic (finely chopped)' → garlic", () => {
    expect(lookupIngredient("garlic (finely chopped)").canonical_id).toBe("garlic");
  });

  test("substitution paren: 'fish sauce (or soy sauce)' → fish_sauce", () => {
    expect(lookupIngredient("fish sauce (or soy sauce)").canonical_id).toBe("fish_sauce");
  });
});

describe("lookupIngredient — adjective stripping", () => {
  test("fresh garlic → garlic", () => {
    expect(lookupIngredient("fresh garlic").canonical_id).toBe("garlic");
  });

  test("dried shiitake mushrooms → mushroom_shiitake_dried", () => {
    const r = lookupIngredient("dried shiitake mushrooms");
    expect(r.canonical_id).toBe("mushroom_shiitake_dried");
  });

  test("frozen shrimp → shrimp", () => {
    expect(lookupIngredient("frozen shrimp").canonical_id).toBe("shrimp");
  });
});

describe("lookupIngredient — soy sauce disambiguation", () => {
  test("'soy sauce' on asian site → soy_sauce_light", () => {
    const r = lookupIngredient("soy sauce", "asian");
    expect(r.canonical_id).toBe("soy_sauce_light");
  });

  test("'soy sauce' on western site → soy_sauce_all_purpose", () => {
    const r = lookupIngredient("soy sauce", "western");
    expect(r.canonical_id).toBe("soy_sauce_all_purpose");
  });

  test("'soy sauce' on unknown cuisine → soy_sauce_all_purpose (safe default)", () => {
    const r = lookupIngredient("soy sauce", "unknown");
    expect(r.canonical_id).toBe("soy_sauce_all_purpose");
  });

  test("'light soy sauce' always → soy_sauce_light regardless of cuisine", () => {
    expect(lookupIngredient("light soy sauce", "western").canonical_id).toBe(
      "soy_sauce_light"
    );
  });
});

describe("lookupIngredient — unknowns", () => {
  test("completely unknown → null", () => {
    const r = lookupIngredient("___mystery_ingredient___");
    expect(r.canonical_id).toBeNull();
    expect(r.method).toBe("unknown");
    expect(r.confidence).toBe(0);
  });
});

// ─── inferCuisineSource ───────────────────────────────────────────────────────

describe("inferCuisineSource", () => {
  test("woksoflife.com → asian", () => {
    expect(inferCuisineSource("https://thewoksoflife.com/mapo-tofu")).toBe("asian");
  });

  test("madewithlau.com → asian", () => {
    expect(inferCuisineSource("https://madewithlau.com/recipe")).toBe("asian");
  });

  test("hot-thai-kitchen.com → asian", () => {
    expect(inferCuisineSource("https://hot-thai-kitchen.com/pad-thai")).toBe("asian");
  });

  test("recipetineats.com → unknown (not a known Asian domain)", () => {
    expect(inferCuisineSource("https://recipetineats.com/pasta")).toBe("unknown");
  });

  test("arbitrary domain → unknown", () => {
    expect(inferCuisineSource("https://example.com/recipe")).toBe("unknown");
  });
});

// ─── Regression: lookup robustness for messy recipe names ─────────────────────

describe("lookupIngredient — messy real-world names", () => {
  const cases: Array<[string, string]> = [
    ["half a medium onion", "onion_yellow"],
    ["grated parmesan cheese for serving", "parmesan"],
    ["shimeji mushrooms", "mushroom_shimeji"],
    ["thai chili paste", "chili_paste_thai"],
    ["thai chilies", "chili_thai"],
    ["good quality whole peeled plum tomatoes", "tomato"],
  ];
  for (const [name, expectedId] of cases) {
    test(`"${name}" → ${expectedId}`, () => {
      const r = lookupIngredient(name, "asian");
      expect(r.canonical_id).toBe(expectedId);
    });
  }
});
