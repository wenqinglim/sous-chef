import { groupBySection, normalizeInstructions } from "@/lib/recipe/sections";

describe("normalizeInstructions", () => {
  test("coerces legacy string[] into InstructionStep[]", () => {
    expect(normalizeInstructions(["Boil water.", "Add pasta."])).toEqual([
      { text: "Boil water.", section: null },
      { text: "Add pasta.", section: null },
    ]);
  });

  test("passes through the new object shape, trimming + nulling blank sections", () => {
    expect(
      normalizeInstructions([
        { text: "Whisk.", section: "Sauce" },
        { text: "Fry.", section: "  " },
        { text: "Serve." },
      ])
    ).toEqual([
      { text: "Whisk.", section: "Sauce" },
      { text: "Fry.", section: null },
      { text: "Serve.", section: null },
    ]);
  });

  test("handles a mix of strings and objects", () => {
    expect(
      normalizeInstructions(["Prep.", { text: "Cook.", section: "Main" }])
    ).toEqual([
      { text: "Prep.", section: null },
      { text: "Cook.", section: "Main" },
    ]);
  });

  test("drops empty text and non-array/garbage input", () => {
    expect(normalizeInstructions(["", { text: "  " }, { foo: "bar" }])).toEqual(
      []
    );
    expect(normalizeInstructions(undefined)).toEqual([]);
    expect(normalizeInstructions(null)).toEqual([]);
    expect(normalizeInstructions("not an array")).toEqual([]);
  });
});

describe("groupBySection", () => {
  const get = (x: { section?: string | null }) => x.section;

  test("all-null items collapse into one ungrouped group", () => {
    const items = [{ section: null }, { section: null }];
    expect(groupBySection(items, get)).toEqual([
      { section: null, items },
    ]);
  });

  test("consecutive runs of the same label group together, order preserved", () => {
    const a = { id: 1, section: "Sauce" };
    const b = { id: 2, section: "Sauce" };
    const c = { id: 3, section: null };
    const d = { id: 4, section: "Garnish" };
    expect(groupBySection([a, b, c, d], (x) => x.section)).toEqual([
      { section: "Sauce", items: [a, b] },
      { section: null, items: [c] },
      { section: "Garnish", items: [d] },
    ]);
  });

  test("a label that reappears after a break starts a new group", () => {
    const items = [
      { section: "A" },
      { section: "B" },
      { section: "A" },
    ];
    const groups = groupBySection(items, (x) => x.section);
    expect(groups.map((g) => g.section)).toEqual(["A", "B", "A"]);
  });

  test("blank/whitespace labels are treated as ungrouped", () => {
    const items = [{ section: "  " }, { section: "" }, { section: undefined }];
    expect(groupBySection(items, (x) => x.section)).toEqual([
      { section: null, items },
    ]);
  });
});
