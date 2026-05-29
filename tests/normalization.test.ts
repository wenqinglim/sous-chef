import {
  findById,
  findByAlias,
  getAllIngredients,
  detectAliasCollisions,
} from "@/lib/registry/registry";

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
