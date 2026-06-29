import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";
import {
  assignIngredientSections,
  cleanIngredientText,
  decodeHtmlEntities,
  extractFromSchemaOrg,
  extractIngredientGroups,
  parseInstructions,
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

// ─── parseInstructions ────────────────────────────────────────────────────────

describe("parseInstructions", () => {
  // Steps that aren't inside a HowToSection carry section: null.
  const plain = (text: string) => ({ text, section: null });

  test("plain string array used directly", () => {
    expect(parseInstructions(["Boil water.", "Add pasta."])).toEqual([
      plain("Boil water."),
      plain("Add pasta."),
    ]);
  });

  test("HowToStep objects → text", () => {
    expect(
      parseInstructions([
        { "@type": "HowToStep", text: "Chop the onion." },
        { "@type": "HowToStep", text: "Fry until golden." },
      ])
    ).toEqual([plain("Chop the onion."), plain("Fry until golden.")]);
  });

  test("HowToStep without text falls back to name", () => {
    expect(
      parseInstructions([{ "@type": "HowToStep", name: "Preheat the oven." }])
    ).toEqual([plain("Preheat the oven.")]);
  });

  test("HowToSection name is captured as the step section", () => {
    expect(
      parseInstructions([
        {
          "@type": "HowToSection",
          name: "For the sauce",
          itemListElement: [
            { "@type": "HowToStep", text: "Whisk the sauce ingredients." },
          ],
        },
        {
          "@type": "HowToSection",
          name: "For the stir fry",
          itemListElement: [
            { "@type": "HowToStep", text: "Stir fry the beef." },
            { "@type": "HowToStep", text: "Add the sauce." },
          ],
        },
      ])
    ).toEqual([
      { text: "Whisk the sauce ingredients.", section: "For the sauce" },
      { text: "Stir fry the beef.", section: "For the stir fry" },
      { text: "Add the sauce.", section: "For the stir fry" },
    ]);
  });

  test("unnamed HowToSection leaves steps ungrouped", () => {
    expect(
      parseInstructions([
        {
          "@type": "HowToSection",
          itemListElement: [
            { "@type": "HowToStep", text: "Stir fry the beef." },
          ],
        },
      ])
    ).toEqual([plain("Stir fry the beef.")]);
  });

  test("nested sections inherit the nearest named section", () => {
    expect(
      parseInstructions([
        {
          "@type": "HowToSection",
          name: "Outer",
          itemListElement: [
            {
              "@type": "HowToSection",
              itemListElement: [{ "@type": "HowToStep", text: "Inner step." }],
            },
          ],
        },
      ])
    ).toEqual([{ text: "Inner step.", section: "Outer" }]);
  });

  test("single plain string split on newlines", () => {
    expect(parseInstructions("Step one.\nStep two.\n\nStep three.")).toEqual([
      plain("Step one."),
      plain("Step two."),
      plain("Step three."),
    ]);
  });

  test("HTML tags stripped from step text", () => {
    expect(
      parseInstructions([{ "@type": "HowToStep", text: "<p>Mix <b>well</b>.</p>" }])
    ).toEqual([plain("Mix well.")]);
  });

  test("undefined/null → []", () => {
    expect(parseInstructions(undefined)).toEqual([]);
    expect(parseInstructions(null)).toEqual([]);
  });

  test("lone unwrapped HowToStep object", () => {
    expect(
      parseInstructions({ "@type": "HowToStep", text: "Only step." })
    ).toEqual([plain("Only step.")]);
  });

  test("lone unwrapped HowToSection object", () => {
    expect(
      parseInstructions({
        "@type": "HowToSection",
        name: "Method",
        itemListElement: [
          { "@type": "HowToStep", text: "First." },
          { "@type": "HowToStep", text: "Second." },
        ],
      })
    ).toEqual([
      { text: "First.", section: "Method" },
      { text: "Second.", section: "Method" },
    ]);
  });

  test("malformed entries skipped, valid ones kept", () => {
    expect(
      parseInstructions([
        { "@type": "HowToStep" }, // no text or name
        "",
        { "@type": "HowToStep", text: "Real step." },
      ])
    ).toEqual([plain("Real step.")]);
  });
});

// ─── cleanIngredientText ──────────────────────────────────────────────────────

describe("cleanIngredientText (WP Recipe Maker artifacts)", () => {
  test("collapses doubled outer parens to single", () => {
    expect(cleanIngredientText("1/4 cup flour ((Note 1))")).toBe(
      "1/4 cup flour (Note 1)"
    );
  });

  test("unwraps leading-comma parens into a trailing note", () => {
    expect(cleanIngredientText("2 garlic cloves (, minced)")).toBe(
      "2 garlic cloves, minced"
    );
  });

  test("unwraps leading-comma parens that themselves contain parens", () => {
    expect(
      cleanIngredientText(
        "500g chicken breast (, boneless and skinless (2 pieces))"
      )
    ).toBe("500g chicken breast, boneless and skinless (2 pieces)");
  });

  test("collapses ((or ...)) substitution notes", () => {
    expect(
      cleanIngredientText(
        "1 1/2 tbsp apple cider vinegar ((or white or other clear vinegar))"
      )
    ).toBe("1 1/2 tbsp apple cider vinegar (or white or other clear vinegar)");
  });

  test("collapses redundant whitespace", () => {
    expect(cleanIngredientText("3 1/2 tbsp  (50g)  unsalted butter")).toBe(
      "3 1/2 tbsp (50g) unsalted butter"
    );
  });

  test("leaves a single clean paren untouched", () => {
    expect(cleanIngredientText("1 cup (240 ml) milk")).toBe(
      "1 cup (240 ml) milk"
    );
  });

  test("leaves text with no parens untouched", () => {
    expect(cleanIngredientText("Salt and pepper")).toBe("Salt and pepper");
  });

  test("decodes a numeric apostrophe entity (WP Recipe Maker)", () => {
    expect(cleanIngredientText("2 tbsp chef&#39;s special sauce")).toBe(
      "2 tbsp chef's special sauce"
    );
  });

  test("decodes &amp; and a zero-padded numeric apostrophe", () => {
    expect(cleanIngredientText("salt &amp; mum&#039;s pepper blend")).toBe(
      "salt & mum's pepper blend"
    );
  });

  test("decodes entities before collapsing doubled parens", () => {
    expect(
      cleanIngredientText("1/4 cup baker&#39;s flour ((Note 1))")
    ).toBe("1/4 cup baker's flour (Note 1)");
  });
});

// ─── decodeHtmlEntities ───────────────────────────────────────────────────────

describe("decodeHtmlEntities", () => {
  test("decodes numeric, hex, and named references", () => {
    expect(decodeHtmlEntities("a&#39;b")).toBe("a'b");
    expect(decodeHtmlEntities("a&#x27;b")).toBe("a'b");
    expect(decodeHtmlEntities("a&apos;b")).toBe("a'b");
    expect(decodeHtmlEntities("salt &amp; pepper")).toBe("salt & pepper");
    expect(decodeHtmlEntities("jalape&#241;o")).toBe("jalapeño");
  });

  test("leaves unknown or malformed references untouched", () => {
    expect(decodeHtmlEntities("100&deg; &bogus; &;")).toBe("100° &bogus; &;");
  });
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

  test("cuisine_source is unknown (recipetineats — not a known Asian domain)", () => {
    const { recipe } = extractFromSchemaOrg(html, url);
    expect(recipe!.cuisine_source).toBe("unknown");
  });

  test("extracts both HowToStep instructions", () => {
    const { recipe } = extractFromSchemaOrg(html, url);
    expect(recipe!.instructions).toEqual([
      { text: "Marinate beef with soy sauce and cornstarch for 15 minutes.", section: null },
      { text: "Heat oil in wok over high heat. Stir fry beef until browned.", section: null },
    ]);
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

  test("extracts instructions", () => {
    expect(extractFromSchemaOrg(html, url).recipe!.instructions).toEqual([
      { text: "Bring a pot of water to a boil and blanch tofu for 1 minute.", section: null },
    ]);
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

  test("extracts instructions from @graph recipe", () => {
    expect(extractFromSchemaOrg(html, url).recipe!.instructions).toEqual([
      { text: "Soak rice noodles in room temperature water for 30 minutes.", section: null },
    ]);
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

  test("extracts instructions", () => {
    expect(extractFromSchemaOrg(html, url).recipe!.instructions).toEqual([
      { text: "Score the fish on both sides with 3-4 diagonal cuts.", section: null },
    ]);
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

  test("missing recipeInstructions does not fail extraction → []", () => {
    const html = `<script type="application/ld+json">{
      "@type": "Recipe",
      "name": "No Steps",
      "recipeIngredient": ["1 egg"],
      "recipeYield": "2"
    }</script>`;
    const r = extractFromSchemaOrg(html, "https://example.com");
    expect(r.recipe).not.toBeNull();
    expect(r.recipe!.instructions).toEqual([]);
  });
});

// ─── Ingredient groups (HTML, since JSON-LD recipeIngredient is flat) ──────────

describe("extractIngredientGroups", () => {
  test("WP Recipe Maker group markup", () => {
    const html = `
      <div class="wprm-recipe-ingredients-container">
        <div class="wprm-recipe-ingredient-group">
          <h4 class="wprm-recipe-ingredient-group-name">For the sauce</h4>
          <ul>
            <li class="wprm-recipe-ingredient">2 tbsp soy sauce</li>
            <li class="wprm-recipe-ingredient">1 tsp sesame oil</li>
          </ul>
        </div>
        <div class="wprm-recipe-ingredient-group">
          <h4 class="wprm-recipe-ingredient-group-name">For the stir fry</h4>
          <ul>
            <li class="wprm-recipe-ingredient">500 g beef</li>
          </ul>
        </div>
      </div>`;
    expect(extractIngredientGroups(cheerio.load(html))).toEqual([
      { name: "For the sauce", items: ["2 tbsp soy sauce", "1 tsp sesame oil"] },
      { name: "For the stir fry", items: ["500 g beef"] },
    ]);
  });

  test("Tasty Recipes headings interleaved with list items", () => {
    const html = `
      <div class="tasty-recipes-ingredients">
        <h4>Marinade</h4>
        <ul><li>1 tbsp shaoxing wine</li><li>1 tsp cornstarch</li></ul>
        <h4>Sauce</h4>
        <ul><li>2 tbsp soy sauce</li></ul>
      </div>`;
    expect(extractIngredientGroups(cheerio.load(html))).toEqual([
      { name: "Marinade", items: ["1 tbsp shaoxing wine", "1 tsp cornstarch"] },
      { name: "Sauce", items: ["2 tbsp soy sauce"] },
    ]);
  });

  test("no group markup → []", () => {
    const html = `<ul><li>1 egg</li><li>2 cups flour</li></ul>`;
    expect(extractIngredientGroups(cheerio.load(html))).toEqual([]);
  });
});

describe("assignIngredientSections", () => {
  const groups = [
    { name: "For the sauce", items: ["2 tbsp soy sauce", "1 tsp sesame oil"] },
    { name: "For the stir fry", items: ["500 g beef"] },
  ];

  test("index alignment when counts match", () => {
    const raw = ["2 tbsp soy sauce", "1 tsp sesame oil", "500 g beef"];
    expect(assignIngredientSections(raw, groups)).toEqual([
      "For the sauce",
      "For the sauce",
      "For the stir fry",
    ]);
  });

  test("text-match fallback when counts differ", () => {
    // 4 JSON-LD lines vs 3 grouped items → index alignment is off, fall back to
    // matching by text; the extra line ("salt") isn't in any group → null.
    const raw = [
      "500 g beef",
      "2 tbsp soy sauce",
      "1 tsp sesame oil",
      "1 pinch salt",
    ];
    expect(assignIngredientSections(raw, groups)).toEqual([
      "For the stir fry",
      "For the sauce",
      "For the sauce",
      null,
    ]);
  });

  test("no groups → all null", () => {
    expect(assignIngredientSections(["1 egg", "2 cups flour"], [])).toEqual([
      null,
      null,
    ]);
  });
});

describe("extractFromSchemaOrg — ingredient sections from HTML groups", () => {
  test("assigns sections by index from WPRM markup alongside JSON-LD", () => {
    const html = `
      <script type="application/ld+json">{
        "@type": "Recipe",
        "name": "Beef Stir Fry",
        "recipeYield": "4",
        "recipeIngredient": ["2 tbsp soy sauce", "1 tsp sesame oil", "500 g beef"],
        "recipeInstructions": [{ "@type": "HowToStep", "text": "Cook it." }]
      }</script>
      <div class="wprm-recipe-ingredient-group">
        <h4 class="wprm-recipe-ingredient-group-name">For the sauce</h4>
        <ul>
          <li class="wprm-recipe-ingredient">2 tbsp soy sauce</li>
          <li class="wprm-recipe-ingredient">1 tsp sesame oil</li>
        </ul>
      </div>
      <div class="wprm-recipe-ingredient-group">
        <h4 class="wprm-recipe-ingredient-group-name">For the stir fry</h4>
        <ul><li class="wprm-recipe-ingredient">500 g beef</li></ul>
      </div>`;
    const { recipe } = extractFromSchemaOrg(html, "https://example.com/beef");
    expect(recipe!.ingredients.map((i) => i.section)).toEqual([
      "For the sauce",
      "For the sauce",
      "For the stir fry",
    ]);
  });

  test("plain ingredient list (no group markup) → sections all null", () => {
    const html = `<script type="application/ld+json">{
      "@type": "Recipe",
      "name": "Simple",
      "recipeYield": "2",
      "recipeIngredient": ["1 egg", "2 cups flour"]
    }</script>`;
    const { recipe } = extractFromSchemaOrg(html, "https://example.com/s");
    expect(recipe!.ingredients.map((i) => i.section)).toEqual([null, null]);
  });
});
