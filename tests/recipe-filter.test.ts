/**
 * filterSummaries() / uniqueTags() / splitByStatus() — pure helpers behind
 * the library's search, tag filter and status tabs in RecipeLibraryGrid.
 * Tested directly so the logic doesn't need a DOM/RTL setup.
 */

import { filterSummaries, splitByStatus, uniqueTags } from "@/lib/recipe-filter";

interface TestSummary {
  id: string;
  title: string;
  tags: string[];
}

function makeSummary(overrides: Partial<TestSummary> = {}): TestSummary {
  return {
    id: "1",
    title: "Green Curry",
    tags: [],
    ...overrides,
  };
}

describe("filterSummaries", () => {
  test("no query, no tags → returns everything", () => {
    const summaries = [makeSummary(), makeSummary({ id: "2", title: "Soup" })];
    expect(filterSummaries(summaries, "", new Set())).toEqual(summaries);
  });

  test("title search is case-insensitive substring match", () => {
    const summaries = [
      makeSummary({ id: "1", title: "Green Curry" }),
      makeSummary({ id: "2", title: "Tomato Soup" }),
    ];
    expect(filterSummaries(summaries, "curry", new Set())).toEqual([
      summaries[0],
    ]);
    expect(filterSummaries(summaries, "GREEN", new Set())).toEqual([
      summaries[0],
    ]);
  });

  test("single tag selection filters to recipes carrying that tag", () => {
    const summaries = [
      makeSummary({ id: "1", tags: ["curry", "weeknight"] }),
      makeSummary({ id: "2", tags: ["baking"] }),
    ];
    expect(filterSummaries(summaries, "", new Set(["curry"]))).toEqual([
      summaries[0],
    ]);
  });

  test("multiple selected tags OR-match (any tag present is enough)", () => {
    const summaries = [
      makeSummary({ id: "1", tags: ["curry"] }),
      makeSummary({ id: "2", tags: ["baking"] }),
      makeSummary({ id: "3", tags: ["soup"] }),
    ];
    expect(
      filterSummaries(summaries, "", new Set(["curry", "baking"]))
    ).toEqual([summaries[0], summaries[1]]);
  });

  test("query and tag filters combine (AND)", () => {
    const summaries = [
      makeSummary({ id: "1", title: "Green Curry", tags: ["curry"] }),
      makeSummary({ id: "2", title: "Red Curry", tags: ["weeknight"] }),
    ];
    expect(
      filterSummaries(summaries, "curry", new Set(["curry"]))
    ).toEqual([summaries[0]]);
  });

  test("empty tag selection does not filter by tags", () => {
    const summaries = [makeSummary({ tags: [] }), makeSummary({ id: "2", tags: ["baking"] })];
    expect(filterSummaries(summaries, "", new Set())).toEqual(summaries);
  });

  test("tag matching is case-insensitive across recipes with differently-cased tags", () => {
    const summaries = [
      makeSummary({ id: "1", tags: ["Curry"] }),
      makeSummary({ id: "2", tags: ["curry"] }),
      makeSummary({ id: "3", tags: ["baking"] }),
    ];
    // Selecting the lowercase chip still matches the recipe stored as "Curry".
    expect(filterSummaries(summaries, "", new Set(["curry"]))).toEqual([
      summaries[0],
      summaries[1],
    ]);
  });
});

describe("uniqueTags", () => {
  test("dedupes case-insensitively, first-seen casing wins", () => {
    const summaries = [
      { title: "a", tags: ["Curry", "weeknight"] },
      { title: "b", tags: ["curry", "Baking"] },
    ];
    expect(uniqueTags(summaries)).toEqual(["Baking", "Curry", "weeknight"]);
  });

  test("returns an empty list when no recipe has tags", () => {
    expect(uniqueTags([{ title: "a", tags: [] }])).toEqual([]);
  });
});

describe("splitByStatus", () => {
  interface StatusSummary {
    id: string;
    status: "tried_and_tested" | "saved_for_later";
  }
  const tried: StatusSummary = { id: "1", status: "tried_and_tested" };
  const saved: StatusSummary = { id: "2", status: "saved_for_later" };

  test("buckets recipes by status", () => {
    expect(splitByStatus([tried, saved])).toEqual({
      tried_and_tested: [tried],
      saved_for_later: [saved],
    });
  });

  test("both buckets exist even when a status has no recipes", () => {
    expect(splitByStatus([tried])).toEqual({
      tried_and_tested: [tried],
      saved_for_later: [],
    });
    expect(splitByStatus([])).toEqual({
      tried_and_tested: [],
      saved_for_later: [],
    });
  });

  test("preserves input order within each bucket", () => {
    const a = { id: "a", status: "saved_for_later" } as const;
    const b = { id: "b", status: "saved_for_later" } as const;
    expect(splitByStatus([b, tried, a]).saved_for_later).toEqual([b, a]);
  });

  test("composes with filterSummaries so tab counts respect the filters", () => {
    const summaries = [
      { id: "1", title: "Green Curry", tags: [], status: "tried_and_tested" as const },
      { id: "2", title: "Tomato Soup", tags: [], status: "tried_and_tested" as const },
      { id: "3", title: "Red Curry", tags: [], status: "saved_for_later" as const },
    ];
    const byStatus = splitByStatus(
      filterSummaries(summaries, "curry", new Set())
    );
    expect(byStatus.tried_and_tested).toEqual([summaries[0]]);
    expect(byStatus.saved_for_later).toEqual([summaries[2]]);
  });
});
