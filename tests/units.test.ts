import { convert, toBaseUnit, isKnownUnit, getUnitFamily } from "@/lib/units/conversions";
import { parseIngredient, parseNumber } from "@/lib/units/parser";

// ─── parseNumber ─────────────────────────────────────────────────────────────

describe("parseNumber", () => {
  test("plain integer", () => expect(parseNumber("3")).toBe(3));
  test("decimal", () => expect(parseNumber("1.5")).toBe(1.5));
  test("plain fraction", () => expect(parseNumber("1/4")).toBeCloseTo(0.25));
  test("mixed number", () => expect(parseNumber("2 1/2")).toBeCloseTo(2.5));
  test("unicode ½", () => expect(parseNumber("½")).toBeCloseTo(0.5));
  test("unicode ¼", () => expect(parseNumber("¼")).toBeCloseTo(0.25));
  test("unicode ¾", () => expect(parseNumber("¾")).toBeCloseTo(0.75));
  test("unicode ⅓", () => expect(parseNumber("⅓")).toBeCloseTo(1 / 3));
  test("integer + unicode fraction 1½", () => expect(parseNumber("1½")).toBeCloseTo(1.5));
  test("integer + unicode fraction 2¾", () => expect(parseNumber("2¾")).toBeCloseTo(2.75));
});

// ─── convert ─────────────────────────────────────────────────────────────────

describe("convert — volume", () => {
  test("1 cup → ml", () => expect(convert(1, "cup", "ml")).toBeCloseTo(236.588));
  test("1 tbsp → ml", () => expect(convert(1, "tbsp", "ml")).toBeCloseTo(14.787));
  test("1 tsp → ml", () => expect(convert(1, "tsp", "ml")).toBeCloseTo(4.929));
  test("1 cup → tbsp", () => expect(convert(1, "cup", "tbsp")).toBeCloseTo(16, 0));
  test("240 ml → cups", () => expect(convert(240, "ml", "cups")).toBeCloseTo(1.015, 1));
  test("1 liter → cups", () => expect(convert(1, "liter", "cups")).toBeCloseTo(4.227, 1));
  test("1 fl oz → ml", () => expect(convert(1, "fl oz", "ml")).toBeCloseTo(29.574));
});

describe("convert — weight", () => {
  test("1 lb → g", () => expect(convert(1, "lb", "g")).toBeCloseTo(453.592));
  test("1 oz → g", () => expect(convert(1, "oz", "g")).toBeCloseTo(28.3495));
  test("1 kg → g", () => expect(convert(1, "kg", "g")).toBeCloseTo(1000));
  test("16 oz → lb", () => expect(convert(16, "oz", "lb")).toBeCloseTo(1));
  test("1 stick → g (butter)", () => expect(convert(1, "stick", "g")).toBeCloseTo(113));
  test("1 inch → g (ginger)", () => expect(convert(1, "inch", "g")).toBeCloseTo(6));
});

describe("convert — cross-family returns null", () => {
  test("cup → g returns null (no density)", () =>
    expect(convert(1, "cup", "g")).toBeNull());
  test("oz (weight) → ml returns null", () =>
    expect(convert(1, "oz", "ml")).toBeNull());
});

describe("toBaseUnit", () => {
  test("cups to ml base", () => {
    const r = toBaseUnit(2, "cups");
    expect(r?.unit).toBe("ml");
    expect(r?.value).toBeCloseTo(473.176);
  });
  test("lb to g base", () => {
    const r = toBaseUnit(1, "lb");
    expect(r?.unit).toBe("g");
    expect(r?.value).toBeCloseTo(453.592);
  });
  test("unknown unit returns null", () => {
    expect(toBaseUnit(1, "fathom")).toBeNull();
  });
});

describe("isKnownUnit / getUnitFamily", () => {
  test("cup is known", () => expect(isKnownUnit("cup")).toBe(true));
  test("cups is known", () => expect(isKnownUnit("cups")).toBe(true));
  test("g is weight", () => expect(getUnitFamily("g")).toBe("weight"));
  test("ml is volume", () => expect(getUnitFamily("ml")).toBe("volume"));
  test("bunch is other", () => expect(getUnitFamily("bunch")).toBe("other"));
  test("unknown returns null", () => expect(getUnitFamily("fathom")).toBeNull());
});

// ─── parseIngredient ──────────────────────────────────────────────────────────

describe("parseIngredient — quantities", () => {
  test("plain integer", () => {
    const r = parseIngredient("2 cups flour");
    expect(r.quantity).toBe(2);
    expect(r.unit).toBe("cups");
    expect(r.name).toBe("flour");
  });

  test("mixed number", () => {
    const r = parseIngredient("2 1/2 cups fish sauce");
    expect(r.quantity).toBeCloseTo(2.5);
    expect(r.unit).toBe("cups");
    expect(r.name).toBe("fish sauce");
  });

  test("unicode fraction ½", () => {
    const r = parseIngredient("½ tsp white pepper");
    expect(r.quantity).toBeCloseTo(0.5);
    expect(r.unit).toBe("tsp");
    expect(r.name).toBe("white pepper");
  });

  test("integer + unicode fraction 1½", () => {
    const r = parseIngredient("1½ cups coconut milk");
    expect(r.quantity).toBeCloseTo(1.5);
    expect(r.unit).toBe("cups");
    expect(r.name).toBe("coconut milk");
  });

  test("range 3-4 → midpoint", () => {
    const r = parseIngredient("3-4 stalks lemongrass");
    expect(r.quantity).toBeCloseTo(3.5);
  });

  test("range with 'to'", () => {
    const r = parseIngredient("2 to 3 cloves garlic");
    expect(r.quantity).toBeCloseTo(2.5);
  });
});

describe("parseIngredient — name cleaning", () => {
  test("strips native-script parens — Chinese", () => {
    const r = parseIngredient("1 tsp ginger (生姜)");
    expect(r.name).toBe("ginger");
  });

  test("strips native-script parens — Thai", () => {
    const r = parseIngredient("2 cups Thai basil (กะเพรา)");
    expect(r.name).toBe("thai basil");
  });

  test("strips substitution alternative", () => {
    const r = parseIngredient("1 tbsp Shaoxing wine (or dry sherry)");
    expect(r.name).toBe("shaoxing wine");
  });

  test("strips prep note after comma", () => {
    const r = parseIngredient("3 cloves garlic, minced");
    expect(r.name).toBe("garlic");
  });

  test("strips 'finely chopped' note", () => {
    const r = parseIngredient("2 scallions, finely chopped");
    expect(r.name).toBe("scallions");
  });
});

describe("parseIngredient — no quantity", () => {
  test("salt to taste", () => {
    const r = parseIngredient("salt to taste");
    expect(r.quantity).toBeNull();
    expect(r.unit).toBeNull();
    expect(r.name).toContain("salt");
  });

  test("bare ingredient name", () => {
    const r = parseIngredient("fresh ginger");
    expect(r.quantity).toBeNull();
    expect(r.unit).toBeNull();
    expect(r.name).toBe("fresh ginger");
  });
});
