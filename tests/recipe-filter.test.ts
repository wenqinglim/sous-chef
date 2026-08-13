/**
 * filterSummaries() — pure library-search/tag-filter predicate used by
 * RecipeLibraryGrid. Tested directly so the filter logic doesn't need a
 * DOM/RTL setup.
 */

import { filterSummaries } from "@/lib/recipe-filter";

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
});
