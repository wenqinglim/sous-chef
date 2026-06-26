import * as fs from "fs";
import * as path from "path";
import {
  cleanIngredientText,
  decodeHtmlEntities,
  extractFromSchemaOrg,
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
  test("plain string array used directly", () => {
    expect(parseInstructions(["Boil water.", "Add pasta."])).toEqual([
      "Boil water.",
      "Add pasta.",
    ]);
  });

  test("HowToStep objects → text", () => {
    expect(
      parseInstructions([
        { "@type": "HowToStep", text: "Chop the onion." },
        { "@type": "HowToStep", text: "Fry until golden." },
      ])
    ).toEqual(["Chop the onion.", "Fry until golden."]);
  });

  test("HowToStep without text falls back to name", () => {
    expect(
      parseInstructions([{ "@type": "HowToStep", name: "Preheat the oven." }])
    ).toEqual(["Preheat the oven."]);
  });

  test("HowToSection with itemListElement is flattened", () => {
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
      "Whisk the sauce ingredients.",
      "Stir fry the beef.",
      "Add the sauce.",
    ]);
  });

  test("nested sections flatten recursively", () => {
    expect(
      parseInstructions([
        {
          "@type": "HowToSection",
          itemListElement: [
            {
              "@type": "HowToSection",
              itemListElement: [{ "@type": "HowToStep", text: "Inner step." }],
            },
          ],
        },
      ])
    ).toEqual(["Inner step."]);
  });

  test("single plain string split on newlines", () => {
    expect(parseInstructions("Step one.\nStep two.\n\nStep three.")).toEqual([
      "Step one.",
      "Step two.",
      "Step three.",
    ]);
  });

  test("HTML tags stripped from step text", () => {
    expect(
      parseInstructions([{ "@type": "HowToStep", text: "<p>Mix <b>well</b>.</p>" }])
    ).toEqual(["Mix well."]);
  });

  test("undefined/null → []", () => {
    expect(parseInstructions(undefined)).toEqual([]);
    expect(parseInstructions(null)).toEqual([]);
  });

  test("lone unwrapped HowToStep object", () => {
    expect(
      parseInstructions({ "@type": "HowToStep", text: "Only step." })
    ).toEqual(["Only step."]);
  });

  test("lone unwrapped HowToSection object", () => {
    expect(
      parseInstructions({
        "@type": "HowToSection",
        itemListElement: [
          { "@type": "HowToStep", text: "First." },
          { "@type": "HowToStep", text: "Second." },
        ],
      })
    ).toEqual(["First.", "Second."]);
  });

  test("malformed entries skipped, valid ones kept", () => {
    expect(
      parseInstructions([
        { "@type": "HowToStep" }, // no text or name
        "",
        { "@type": "HowToStep", text: "Real step." },
      ])
    ).toEqual(["Real step."]);
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
      "Marinate beef with soy sauce and cornstarch for 15 minutes.",
      "Heat oil in wok over high heat. Stir fry beef until browned.",
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
      "Bring a pot of water to a boil and blanch tofu for 1 minute.",
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
      "Soak rice noodles in room temperature water for 30 minutes.",
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
      "Score the fish on both sides with 3-4 diagonal cuts.",
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
