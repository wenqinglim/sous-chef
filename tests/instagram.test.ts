import * as fs from "fs";
import * as path from "path";

// Mock the LLM extractor so the heuristic/orchestration tests never hit Claude
// and we can assert whether the LLM was reached.
jest.mock("@/lib/extractors/llm-fallback", () => ({
  extractWithLlm: jest.fn(),
}));

import { extractWithLlm } from "@/lib/extractors/llm-fallback";
import {
  isInstagramUrl,
  extractInstagramCaption,
  looksLikeRecipe,
  extractFromInstagram,
} from "@/lib/extractors/instagram";

const mockedExtractWithLlm = extractWithLlm as jest.MockedFunction<
  typeof extractWithLlm
>;

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf-8");
}

const recipeHtml = loadFixture("instagram-recipe.html");
const nonRecipeHtml = loadFixture("instagram-non-recipe.html");

beforeEach(() => {
  mockedExtractWithLlm.mockReset();
});

// ─── isInstagramUrl ─────────────────────────────────────────────────────────

describe("isInstagramUrl", () => {
  test.each([
    "https://www.instagram.com/reel/ABC123/",
    "https://instagram.com/p/ABC123/",
    "https://www.instagram.com/tv/ABC123/",
    "https://m.instagram.com/reel/ABC123/?utm_source=ig_web",
    "https://instagr.am/reel/ABC123/",
  ])("recognises %s", (url) => {
    expect(isInstagramUrl(url)).toBe(true);
  });

  test.each([
    "https://recipetineats.com/beef-stir-fry/",
    "https://thewoksoflife.com/mapo-tofu/",
    "https://notinstagram.com/reel/ABC",
    "not a url",
  ])("rejects %s", (url) => {
    expect(isInstagramUrl(url)).toBe(false);
  });
});

// ─── extractInstagramCaption ──────────────────────────────────────────────────

describe("extractInstagramCaption", () => {
  test("recovers the full caption from a recipe reel", () => {
    const caption = extractInstagramCaption(recipeHtml);
    expect(caption).not.toBeNull();
    expect(caption).toContain("Garlic Butter Noodles");
    expect(caption).toContain("200g noodles");
    expect(caption).toContain("Method:");
    // engagement/attribution preamble must be stripped
    expect(caption).not.toMatch(/likes,/i);
    expect(caption).not.toMatch(/chef_demo on March/i);
  });

  test("recovers a non-recipe caption too (gating happens later)", () => {
    const caption = extractInstagramCaption(nonRecipeHtml);
    expect(caption).toContain("Golden hour");
  });

  test("falls back to og:description when no JSON-LD is present", () => {
    const html = `<html><head>
      <meta property="og:description" content="123 likes, 4 comments - cook on May 1, 2024: &quot;1 cup flour, 2 eggs, mix and bake. Ingredients below.&quot;" />
    </head><body></body></html>`;
    expect(extractInstagramCaption(html)).toBe(
      "1 cup flour, 2 eggs, mix and bake. Ingredients below."
    );
  });

  test("strips the preamble when the reel has no comments", () => {
    const html = `<html><head>
      <meta property="og:description" content="987 likes - cook on May 1, 2024: &quot;1 cup flour, 2 eggs. Ingredients below.&quot;" />
    </head><body></body></html>`;
    expect(extractInstagramCaption(html)).toBe(
      "1 cup flour, 2 eggs. Ingredients below."
    );
  });

  test("strips a bare 'user on Instagram:' attribution with no counts", () => {
    const html = `<html><head>
      <meta property="og:description" content="cook on Instagram: &quot;1 cup flour, 2 eggs. Ingredients below.&quot;" />
    </head><body></body></html>`;
    expect(extractInstagramCaption(html)).toBe(
      "1 cup flour, 2 eggs. Ingredients below."
    );
  });

  test("does not strip a real caption that merely contains a colon", () => {
    const html = `<html><head>
      <meta name="description" content="Garlic Noodles: 200g noodles, 3 tbsp butter. Method below." />
    </head><body></body></html>`;
    expect(extractInstagramCaption(html)).toBe(
      "Garlic Noodles: 200g noodles, 3 tbsp butter. Method below."
    );
  });

  test("prefers the JSON-LD 'caption' field over a longer boilerplate description", () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {
        "@type": "VideoObject",
        "description": "See photos and videos from this and thousands of other creators on Instagram. Follow for daily updates and more.",
        "caption": "200g noodles, 3 tbsp butter, 4 cloves garlic. Method: cook and toss."
      }
      </script>
    </head><body></body></html>`;
    expect(extractInstagramCaption(html)).toBe(
      "200g noodles, 3 tbsp butter, 4 cloves garlic. Method: cook and toss."
    );
  });

  test("returns null when the page exposes no caption (login wall)", () => {
    const html = `<html><head><title>Login • Instagram</title></head><body></body></html>`;
    expect(extractInstagramCaption(html)).toBeNull();
  });
});

// ─── looksLikeRecipe ──────────────────────────────────────────────────────────

describe("looksLikeRecipe", () => {
  test("true for a caption with recipe keywords", () => {
    expect(
      looksLikeRecipe(extractInstagramCaption(recipeHtml) as string)
    ).toBe(true);
  });

  test("true via quantity+unit measurements without an explicit keyword", () => {
    expect(
      looksLikeRecipe(
        "200g flour, 3 tbsp butter, 2 cups milk, a pinch of salt — mix and pan-fry until golden brown all over"
      )
    ).toBe(true);
  });

  test("false for a non-recipe caption", () => {
    expect(
      looksLikeRecipe(extractInstagramCaption(nonRecipeHtml) as string)
    ).toBe(false);
  });

  test("false for short/empty captions", () => {
    expect(looksLikeRecipe("yum 🍜")).toBe(false);
    expect(looksLikeRecipe("")).toBe(false);
  });
});

// ─── extractFromInstagram ─────────────────────────────────────────────────────

describe("extractFromInstagram", () => {
  test("rejects a non-recipe reel as 'no_recipe' WITHOUT calling the LLM", async () => {
    const result = await extractFromInstagram(
      nonRecipeHtml,
      "https://instagram.com/reel/ABC123/"
    );
    expect(result.recipe).toBeNull();
    expect(result.error).toMatch(/doesn't look like a recipe/i);
    expect(result.kind).toBe("no_recipe");
    expect(mockedExtractWithLlm).not.toHaveBeenCalled();
  });

  test("flags a login-walled page as 'extractor_error' WITHOUT calling the LLM", async () => {
    const html = `<html><head><title>Login</title></head><body></body></html>`;
    const result = await extractFromInstagram(
      html,
      "https://instagram.com/reel/ABC123/"
    );
    expect(result.recipe).toBeNull();
    expect(result.error).toMatch(/caption/i);
    expect(result.kind).toBe("extractor_error");
    expect(mockedExtractWithLlm).not.toHaveBeenCalled();
  });

  test("propagates an LLM/infra failure as 'extractor_error'", async () => {
    mockedExtractWithLlm.mockResolvedValue({
      recipe: null,
      error: "LLM API call failed: network down",
      kind: "extractor_error",
    });
    const result = await extractFromInstagram(
      recipeHtml,
      "https://instagram.com/reel/ABC123/"
    );
    expect(mockedExtractWithLlm).toHaveBeenCalledTimes(1);
    expect(result.recipe).toBeNull();
    expect(result.kind).toBe("extractor_error");
  });

  test("delegates a recipe caption to the LLM extractor", async () => {
    mockedExtractWithLlm.mockResolvedValue({
      recipe: {
        id: "x",
        url: "https://instagram.com/reel/ABC123/",
        title: "Garlic Butter Noodles",
        base_servings: 2,
        parsed_at: new Date().toISOString(),
        cuisine_source: "unknown",
        ingredients: [],
        instructions: [],
      },
    });

    const url = "https://instagram.com/reel/ABC123/";
    const result = await extractFromInstagram(recipeHtml, url);

    expect(mockedExtractWithLlm).toHaveBeenCalledTimes(1);
    const [captionArg, urlArg] = mockedExtractWithLlm.mock.calls[0];
    expect(captionArg).toContain("200g noodles");
    expect(urlArg).toBe(url);
    expect(result.recipe?.title).toBe("Garlic Butter Noodles");
  });
});
