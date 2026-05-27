import * as fs from "fs";
import * as path from "path";
import {
  extractFromSchemaOrg,
  parseServings,
} from "@/lib/extractors/schema-org";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadFixture(name: string): string {
  return fs.readFileSync(
    path.join(__dirname, "fixtures", name),
    "utf-8"
  );
}

// ─── parseServings ────────────────────────────────────────────────────────────

describe("parseServings", () => {
  test("plain number string", () => expect(parseServings("4")).toBe(4));
  test("numeric value", () => expect(parseServings(6)).toBe(6));
  test("'4 servings'", () => expect(parseServings("4 servings")).toBe(4));
  test("'Serves 4'", () => expect(parseServings("Serves 4")).toBe(4));
  test("range '4-6 servings' → lower bound 4", () =>
    expect(parseServings("4-6 servings")).toBe(4));
  test("range '2-3 servings' → lower bound 2", () =>
    expect(parseServings("2-3 servings")).toBe(2));
  test("'Makes 12 cookies'", () => expect(parseServings("Makes 12 cookies")).toBe(12));
  test("array ['4-6 servings']", () =>
    expect(parseServings(["4-6 servings"])).toBe(4));
  test("undefined → null", () => expect(parseServings(undefined)).toBeNull());
  test("'no number here' → null", () =>
    expect(parseServings("no number here")).toBeNull());
});

// ─── RecipeTin Eats fixture ───────────────────────────────────────────────────

describe("RecipeTin Eats — Beef Stir Fry", () => {
  const html = loadFixture("recipetineats.html");
  const url = "https://recipetineats.com/beef-stir-fry/";

  test("extracts successfully", () => {
    const result = extractFromSchemaOrg(html, url);
    expect(result.recipe).not.toBeNull();
    expect(result.error).toBeUndefined();
  });

  test("title is correct", () => {
    const { recipe } = extractFromSchemaOrg(html, url);
    expect(recipe!.title).toBe("Beef Stir Fry");
  });

  test("base_servings is 4", () => {
    const { recipe } = extractFromSchemaOrg(html, url);
    expect(recipe!.base_servings).toBe(4);
  });

  test("has at least 5 ingredients", () => {
    const { recipe } = extractFromSchemaOrg(html, url);
    expect(recipe!.ingredients.length).toBeGreaterThanOrEqual(5);
  });

  test("each ingredient has a non-empty raw_text", () => {
    const { recipe } = extractFromSchemaOrg(html, url);
    for (const ing of recipe!.ingredients) {
      expect(ing.raw_text.length).toBeGreaterThan(0);
    }
  });

  test("cuisine_source is western (recipetineats)", () => {
    const { recipe } = extractFromSchemaOrg(html, url);
    expect(recipe!.cuisine_source).toBe("western");
  });
});

// ─── Woks of Life fixture ─────────────────────────────────────────────────────

describe("Woks of Life — Mapo Tofu", () => {
  const html = loadFixture("woksoflife.html");
  const url = "https://thewoksoflife.com/mapo-tofu/";

  test("extracts successfully", () => {
    expect(extractFromSchemaOrg(html, url).recipe).not.toBeNull();
  });

  test("title is 'Mapo Tofu'", () => {
    expect(extractFromSchemaOrg(html, url).recipe!.title).toBe("Mapo Tofu");
  });

  test("base_servings is 4", () => {
    expect(extractFromSchemaOrg(html, url).recipe!.base_servings).toBe(4);
  });

  test("has at least 8 ingredients", () => {
    expect(
      extractFromSchemaOrg(html, url).recipe!.ingredients.length
    ).toBeGreaterThanOrEqual(8);
  });

  test("cuisine_source is asian", () => {
    expect(extractFromSchemaOrg(html, url).recipe!.cuisine_source).toBe("asian");
  });
});

// ─── Hot Thai Kitchen fixture ─────────────────────────────────────────────────

describe("Hot Thai Kitchen — Pad Thai (uses @graph)", () => {
  const html = loadFixture("hotthaikitchen.html");
  const url = "https://hot-thai-kitchen.com/pad-thai/";

  test("extracts from @graph array", () => {
    expect(extractFromSchemaOrg(html, url).recipe).not.toBeNull();
  });

  test("title is 'Pad Thai'", () => {
    expect(extractFromSchemaOrg(html, url).recipe!.title).toBe("Pad Thai");
  });

  test("range yield '2-3 servings' → 2 (lower bound)", () => {
    expect(extractFromSchemaOrg(html, url).recipe!.base_servings).toBe(2);
  });

  test("has at least 8 ingredients", () => {
    expect(
      extractFromSchemaOrg(html, url).recipe!.ingredients.length
    ).toBeGreaterThanOrEqual(8);
  });

  test("cuisine_source is asian", () => {
    expect(extractFromSchemaOrg(html, url).recipe!.cuisine_source).toBe("asian");
  });

  test("Thai script present in raw_text (not stripped by extractor)", () => {
    const { recipe } = extractFromSchemaOrg(html, url);
    const rawTexts = recipe!.ingredients.map((i) => i.raw_text).join(" ");
    // Thai characters should still be in raw_text — stripping happens at normalization
    expect(rawTexts).toMatch(/[฀-๿]/);
  });
});

// ─── Made With Lau fixture ────────────────────────────────────────────────────

describe("Made With Lau — Cantonese Steamed Fish", () => {
  const html = loadFixture("madewithlau.html");
  const url = "https://madewithlau.com/recipes/cantonese-steamed-fish";

  test("extracts successfully", () => {
    expect(extractFromSchemaOrg(html, url).recipe).not.toBeNull();
  });

  test("title correct", () => {
    expect(extractFromSchemaOrg(html, url).recipe!.title).toBe(
      "Cantonese Steamed Fish"
    );
  });

  test("base_servings is 2", () => {
    expect(extractFromSchemaOrg(html, url).recipe!.base_servings).toBe(2);
  });

  test("has at least 5 ingredients", () => {
    expect(
      extractFromSchemaOrg(html, url).recipe!.ingredients.length
    ).toBeGreaterThanOrEqual(5);
  });

  test("cuisine_source is asian", () => {
    expect(extractFromSchemaOrg(html, url).recipe!.cuisine_source).toBe("asian");
  });

  test("Chinese characters present in raw_text (preserved by extractor)", () => {
    const { recipe } = extractFromSchemaOrg(html, url);
    const rawTexts = recipe!.ingredients.map((i) => i.raw_text).join(" ");
    expect(rawTexts).toMatch(/[一-鿿]/);
  });
});

// ─── Error cases ──────────────────────────────────────────────────────────────

describe("Error cases", () => {
  test("empty HTML → error", () => {
    const r = extractFromSchemaOrg("", "https://example.com");
    expect(r.recipe).toBeNull();
    expect(r.error).toBeTruthy();
  });

  test("HTML with no LD+JSON → error", () => {
    const r = extractFromSchemaOrg(
      "<html><body><p>Hello</p></body></html>",
      "https://example.com"
    );
    expect(r.recipe).toBeNull();
  });

  test("LD+JSON with no Recipe type → error", () => {
    const html = `<script type="application/ld+json">{"@type":"WebPage","name":"Test"}</script>`;
    const r = extractFromSchemaOrg(html, "https://example.com");
    expect(r.recipe).toBeNull();
  });
});
