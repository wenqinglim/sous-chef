import { isInstagramUrl, looksLikeRecipe } from "@/lib/extractors/instagram";

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

// ─── looksLikeRecipe ──────────────────────────────────────────────────────────

describe("looksLikeRecipe", () => {
  test("true for a caption with recipe keywords", () => {
    expect(
      looksLikeRecipe(
        "Garlic Butter Noodles — the easiest dinner. Method: boil, toss in butter, serve."
      )
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
      looksLikeRecipe(
        "Golden hour vibes at the coast, what a beautiful calm evening by the sea"
      )
    ).toBe(false);
  });

  test("false for short/empty captions", () => {
    expect(looksLikeRecipe("yum 🍜")).toBe(false);
    expect(looksLikeRecipe("")).toBe(false);
  });
});
