import type { RecipeStatus } from "@/types";

/** Shape RecipeLibraryGrid's search/tag filter needs; nothing more. */
export interface FilterableSummary {
  title: string;
  tags: string[];
}

/**
 * Title search (case-insensitive substring) AND-ed with tag OR-match.
 * Tag matching is case-insensitive: tags are deduped case-insensitively per
 * recipe on write (see normalizeTags in src/lib/db/recipes.ts), but two
 * recipes can still store the same tag under different casing (e.g. "Curry"
 * vs "curry") if they were tagged separately, so cross-recipe comparisons
 * must fold case too.
 */
export function filterSummaries<T extends FilterableSummary>(
  summaries: T[],
  query: string,
  selectedTags: Set<string>
): T[] {
  const q = query.trim().toLowerCase();
  const selectedLower = new Set(
    Array.from(selectedTags, (t) => t.toLowerCase())
  );
  return summaries.filter((s) => {
    const matchesQuery = !q || s.title.toLowerCase().includes(q);
    const matchesTags =
      selectedLower.size === 0 ||
      s.tags.some((t) => selectedLower.has(t.toLowerCase()));
    return matchesQuery && matchesTags;
  });
}

/**
 * Unique tags across recipes, case-insensitively deduped (first-seen casing
 * wins) so e.g. "Curry" and "curry" on different recipes collapse into one
 * filter chip instead of two.
 */
export function uniqueTags(summaries: FilterableSummary[]): string[] {
  const seen = new Map<string, string>();
  for (const s of summaries) {
    for (const tag of s.tags) {
      const key = tag.toLowerCase();
      if (!seen.has(key)) seen.set(key, tag);
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}

/** Shape the library's status tabs need; nothing more. */
export interface StatusedSummary {
  status: RecipeStatus;
}

/**
 * Split recipes into one bucket per curation status, for the library's tabs.
 * Every status key is always present (empty array when nothing matches), so
 * callers can index by the active tab without a fallback.
 *
 * Order within each bucket is preserved, so this composes with
 * filterSummaries() — split the filtered list, not the raw one, to get
 * per-tab counts that respect the active search/tag filters.
 */
export function splitByStatus<T extends StatusedSummary>(
  summaries: T[]
): Record<RecipeStatus, T[]> {
  const byStatus: Record<RecipeStatus, T[]> = {
    tried_and_tested: [],
    saved_for_later: [],
  };
  for (const s of summaries) byStatus[s.status].push(s);
  return byStatus;
}
