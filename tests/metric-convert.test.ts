import {
  convertLineToMetric,
  isConvertibleToMetric,
} from "@/lib/units/metric-convert";

describe("isConvertibleToMetric", () => {
  test("US weight units are convertible", () => {
    expect(isConvertibleToMetric("oz")).toBe(true);
    expect(isConvertibleToMetric("lb")).toBe(true);
    expect(isConvertibleToMetric("pounds")).toBe(true);
  });

  test("US volume units are convertible", () => {
    expect(isConvertibleToMetric("cup")).toBe(true);
    expect(isConvertibleToMetric("tbsp")).toBe(true);
    expect(isConvertibleToMetric("tsp")).toBe(true);
    expect(isConvertibleToMetric("fl oz")).toBe(true);
  });

  test("already-metric units are not convertible", () => {
    expect(isConvertibleToMetric("g")).toBe(false);
    expect(isConvertibleToMetric("kg")).toBe(false);
    expect(isConvertibleToMetric("ml")).toBe(false);
    expect(isConvertibleToMetric("l")).toBe(false);
  });

  test("count and opaque units are not convertible", () => {
    expect(isConvertibleToMetric("clove")).toBe(false);
    expect(isConvertibleToMetric("can")).toBe(false);
    expect(isConvertibleToMetric("bunch")).toBe(false);
  });

  test("unknown unit is not convertible", () => {
    expect(isConvertibleToMetric("fathom")).toBe(false);
  });

  test("length-as-weight ginger units are not convertible", () => {
    expect(isConvertibleToMetric("inch")).toBe(false);
    expect(isConvertibleToMetric("inches")).toBe(false);
    expect(isConvertibleToMetric("cm")).toBe(false);
  });
});

describe("convertLineToMetric — pass-through cases", () => {
  test("empty input → unchanged", () => {
    expect(convertLineToMetric("")).toBe("");
  });

  test("no leading number → unchanged", () => {
    expect(convertLineToMetric("salt to taste")).toBe("salt to taste");
  });

  test("already-metric unit → unchanged", () => {
    expect(convertLineToMetric("200 g flour")).toBe("200 g flour");
    expect(convertLineToMetric("240 ml milk")).toBe("240 ml milk");
  });

  test("count unit → unchanged", () => {
    expect(convertLineToMetric("3 cloves garlic")).toBe("3 cloves garlic");
  });

  test("opaque purchase unit → unchanged", () => {
    expect(convertLineToMetric("1 can chickpeas")).toBe("1 can chickpeas");
  });

  test("ginger sized by length (inch/cm) → unchanged, not reinterpreted as weight", () => {
    expect(convertLineToMetric("1 inch ginger, sliced")).toBe(
      "1 inch ginger, sliced"
    );
    expect(convertLineToMetric("2 cm ginger, sliced")).toBe(
      "2 cm ginger, sliced"
    );
  });

  test("parenthetical metric equivalent already present → leading qty unchanged", () => {
    expect(convertLineToMetric("1 cup (240 ml) milk")).toBe(
      "1 cup (240 ml) milk"
    );
    expect(convertLineToMetric("2 cups (480 ml) milk")).toBe(
      "2 cups (480 ml) milk"
    );
  });
});

describe("convertLineToMetric — weight", () => {
  test("oz → g", () => {
    expect(convertLineToMetric("8 oz flour")).toBe("227 g flour");
  });

  test("lb → g under 1kg", () => {
    expect(convertLineToMetric("1 lb chicken")).toBe("454 g chicken");
  });

  test("lb → kg over 1000g", () => {
    expect(convertLineToMetric("3 lb chicken")).toBe("1.36 kg chicken");
  });

  test("preserves trailing prep notes", () => {
    expect(convertLineToMetric("2 lb carrots, sliced")).toBe(
      "907 g carrots, sliced"
    );
  });
});

describe("convertLineToMetric — volume", () => {
  test("cup → ml", () => {
    expect(convertLineToMetric("1 cup milk")).toBe("237 ml milk");
  });

  test("tbsp → ml", () => {
    expect(convertLineToMetric("2 tbsp oil")).toBe("30 ml oil");
  });

  test("tsp → ml", () => {
    expect(convertLineToMetric("1 tsp vanilla extract")).toBe(
      "5 ml vanilla extract"
    );
  });

  test("fl oz → ml", () => {
    expect(convertLineToMetric("4 fl oz stock")).toBe("118 ml stock");
  });

  test("gallon → L over 1000ml", () => {
    expect(convertLineToMetric("1 gallon water")).toBe("3.79 L water");
  });
});

describe("convertLineToMetric — ranges", () => {
  test("range scaled to consistent target unit", () => {
    expect(convertLineToMetric("3-4 oz cheese")).toBe("85-113 g cheese");
  });
});

describe("convertLineToMetric — non-leading quantity", () => {
  test("name, quantity unit — converts in place", () => {
    expect(convertLineToMetric("Soy sauce, 2 tbsp")).toBe("Soy sauce, 30 ml");
  });
});
