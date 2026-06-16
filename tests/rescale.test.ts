import { rescaleIngredientLine, formatScaledQty } from "@/lib/units/rescale";

describe("formatScaledQty", () => {
  test("whole numbers", () => {
    expect(formatScaledQty(1)).toBe("1");
    expect(formatScaledQty(3)).toBe("3");
  });

  test("common fractions render as glyphs", () => {
    expect(formatScaledQty(0.25)).toBe("¼");
    expect(formatScaledQty(0.5)).toBe("½");
    expect(formatScaledQty(0.75)).toBe("¾");
    expect(formatScaledQty(1 / 3)).toBe("⅓");
    expect(formatScaledQty(2 / 3)).toBe("⅔");
  });

  test("mixed numbers", () => {
    expect(formatScaledQty(1.5)).toBe("1½");
    expect(formatScaledQty(2.25)).toBe("2¼");
    expect(formatScaledQty(3.75)).toBe("3¾");
  });

  test("near-integer snaps up", () => {
    // 0.99 → 1 (within 1% tolerance)
    expect(formatScaledQty(0.99)).toBe("1");
  });

  test("non-common fraction falls back to decimal", () => {
    expect(formatScaledQty(0.42)).toBe("0.42");
  });

  test("large numbers round to integer", () => {
    expect(formatScaledQty(12.4)).toBe("12");
    expect(formatScaledQty(150)).toBe("150");
  });

  test("non-positive / non-finite", () => {
    expect(formatScaledQty(0)).toBe("0");
    expect(formatScaledQty(-1)).toBe("0");
    expect(formatScaledQty(Infinity)).toBe("0");
    expect(formatScaledQty(NaN)).toBe("0");
  });
});

describe("rescaleIngredientLine — pass-through cases", () => {
  test("scale 1 → unchanged", () => {
    expect(rescaleIngredientLine("2 cups flour", 1)).toBe("2 cups flour");
  });

  test("zero / negative / non-finite → unchanged", () => {
    expect(rescaleIngredientLine("2 cups flour", 0)).toBe("2 cups flour");
    expect(rescaleIngredientLine("2 cups flour", -1)).toBe("2 cups flour");
    expect(rescaleIngredientLine("2 cups flour", NaN)).toBe("2 cups flour");
  });

  test("no leading number → unchanged", () => {
    expect(rescaleIngredientLine("salt to taste", 2)).toBe("salt to taste");
    expect(rescaleIngredientLine("pepper, as needed", 1.5)).toBe(
      "pepper, as needed"
    );
  });

  test("empty input → unchanged", () => {
    expect(rescaleIngredientLine("", 2)).toBe("");
  });
});

describe("rescaleIngredientLine — leading quantity rewritten", () => {
  test("integer doubled", () => {
    expect(rescaleIngredientLine("2 cups flour", 2)).toBe("4 cups flour");
  });

  test("integer halved → fraction", () => {
    expect(rescaleIngredientLine("2 cups flour", 0.5)).toBe("1 cups flour");
  });

  test("decimal scaled", () => {
    expect(rescaleIngredientLine("1.5 lb chicken", 2)).toBe("3 lb chicken");
  });

  test("plain fraction scaled", () => {
    expect(rescaleIngredientLine("1/4 tsp salt", 2)).toBe("½ tsp salt");
  });

  test("mixed number scaled", () => {
    expect(rescaleIngredientLine("1 1/2 cups water", 2)).toBe("3 cups water");
  });

  test("integer + unicode fraction scaled", () => {
    expect(rescaleIngredientLine("1½ cups milk", 2)).toBe("3 cups milk");
  });

  test("integer + space + unicode fraction scaled", () => {
    expect(rescaleIngredientLine("1 ½ cups milk", 2)).toBe("3 cups milk");
  });

  test("bare unicode fraction scaled", () => {
    expect(rescaleIngredientLine("½ tsp pepper", 3)).toBe("1½ tsp pepper");
  });

  test("range scaled (both endpoints)", () => {
    expect(rescaleIngredientLine("3-4 cloves garlic", 2)).toBe(
      "6-8 cloves garlic"
    );
  });

  test("range with 'to' scaled", () => {
    expect(rescaleIngredientLine("2 to 3 tbsp oil", 2)).toBe("4-6 tbsp oil");
  });

  test("preserves trailing prep notes", () => {
    expect(rescaleIngredientLine("2 cloves garlic, minced", 3)).toBe(
      "6 cloves garlic, minced"
    );
  });

  test("preserves parentheticals", () => {
    expect(
      rescaleIngredientLine("1 tbsp oyster sauce (or hoisin sauce)", 2)
    ).toBe("2 tbsp oyster sauce (or hoisin sauce)");
  });

  test("scaling to a third yields ⅓ glyph", () => {
    expect(rescaleIngredientLine("1 cup rice", 1 / 3)).toBe("⅓ cup rice");
  });

  test("scaling triggers awkward decimal when no fraction fits", () => {
    // 1 * 0.42 = 0.42 → no fraction match, falls back to decimal
    expect(rescaleIngredientLine("1 tsp cumin", 0.42)).toBe("0.42 tsp cumin");
  });
});
