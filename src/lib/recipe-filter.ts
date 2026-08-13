/** Shape RecipeLibraryGrid's search/tag filter needs; nothing more. */
export interface FilterableSummary {
  title: string;
  tags: string[];
}

/** Title search (case-insensitive substring) AND-ed with tag OR-match. */
export function filterSummaries<T extends FilterableSummary>(
  summaries: T[],
  query: string,
  selectedTags: Set<string>
): T[] {
  const q = query.trim().toLowerCase();
  return summaries.filter((s) => {
    const matchesQuery = !q || s.title.toLowerCase().includes(q);
    const matchesTags =
      selectedTags.size === 0 || s.tags.some((t) => selectedTags.has(t));
    return matchesQuery && matchesTags;
  });
}
