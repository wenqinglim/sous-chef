"use client";

/**
 * RecipeLibraryGrid — the home-page recipe library.
 *
 * Lists saved recipes (GET /api/recipes) as cards that link into the detail
 * page. Delete happens in place. The library being unreachable degrades to a
 * muted message rather than an error wall.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { RecipeStatus } from "@/types";
import { useIsAdmin } from "@/components/AdminProvider";
import { filterSummaries, splitByStatus, uniqueTags } from "@/lib/recipe-filter";

interface RecipeSummary {
  id: string;
  url: string;
  title: string;
  base_servings: number;
  ingredient_count: number;
  has_instructions: boolean;
  edited: boolean;
  has_notes: boolean;
  status: RecipeStatus;
  tags: string[];
  created_at: string;
}

const MAX_VISIBLE_TAGS = 4;

/** Library tabs, in display order. Admin-only — see the tablist below. */
const TABS = [
  { status: "tried_and_tested", label: "Tried & Tested" },
  { status: "saved_for_later", label: "Want to Try" },
] as const;

const tabId = (status: RecipeStatus) => `library-tab-${status}`;
const panelId = (status: RecipeStatus) => `library-panel-${status}`;

export default function RecipeLibraryGrid() {
  const isAdmin = useIsAdmin();
  const [summaries, setSummaries] = useState<RecipeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<RecipeStatus>("tried_and_tested");
  // Hooks must run unconditionally (before the loading/empty early returns).
  const allTags = useMemo(() => uniqueTags(summaries ?? []), [summaries]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/recipes");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load library");
        if (!cancelled) setSummaries(data.recipes);
      } catch {
        if (!cancelled) setError("Recipes are unavailable right now.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDelete(
    e: React.MouseEvent,
    summary: RecipeSummary
  ) {
    // The card is a link; don't navigate when deleting.
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`Delete "${summary.title}" from your library?`)) return;

    setError(null);
    setBusyId(summary.id);
    try {
      const res = await fetch(`/api/recipes/${summary.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to delete recipe");
      }
      setSummaries((prev) =>
        prev ? prev.filter((s) => s.id !== summary.id) : prev
      );
    } catch {
      setError("Couldn't delete that recipe — try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleStatus(
    e: React.MouseEvent,
    summary: RecipeSummary
  ) {
    // The card is a link; don't navigate when toggling.
    e.preventDefault();
    e.stopPropagation();

    const next =
      summary.status === "saved_for_later"
        ? "tried_and_tested"
        : "saved_for_later";
    setError(null);
    setBusyId(summary.id);
    try {
      const res = await fetch(`/api/recipes/${summary.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to update status");
      }
      setSummaries((prev) =>
        prev
          ? prev.map((s) => (s.id === summary.id ? { ...s, status: next } : s))
          : prev
      );
    } catch {
      setError("Couldn't update that recipe's status — try again.");
    } finally {
      setBusyId(null);
    }
  }

  if (error && !summaries) {
    return <p className="text-sm text-stone-400 mt-6">{error}</p>;
  }

  if (!summaries) {
    return <p className="text-sm text-stone-400 mt-6">Loading recipes…</p>;
  }

  if (summaries.length === 0) {
    return (
      <div className="mt-6 text-center text-sm text-stone-500 border border-dashed border-stone-300 rounded-xl py-10 px-4">
        {isAdmin
          ? "No saved recipes yet. Paste a recipe URL above to start your library."
          : "No saved recipes yet."}
      </div>
    );
  }

  function toggleTag(tag: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  // Arrow/Home/End move between tabs (the tablist is a single tab stop).
  function handleTabKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    const current = TABS.findIndex((t) => t.status === activeTab);
    let next: number;
    if (e.key === "ArrowRight") next = (current + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (current - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    else return;
    e.preventDefault();
    setActiveTab(TABS[next].status);
    document.getElementById(tabId(TABS[next].status))?.focus();
  }

  const filtered = filterSummaries(summaries, query, selectedTags);

  // Non-admins only ever receive tried_and_tested rows (server-filtered), so
  // there's nothing to split into tabs for them — they see one plain grid.
  const byStatus = splitByStatus(filtered);
  const ordered = isAdmin ? byStatus[activeTab] : filtered;

  return (
    <div className="mt-6">
      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

      <div className="max-w-2xl">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search recipes…"
          className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500"
          aria-label="Search recipes"
        />
      </div>

      {isAdmin && (
        <div
          role="tablist"
          aria-label="Recipe status"
          className="mt-4 flex gap-4 border-b border-stone-200"
        >
          {TABS.map((tab) => {
            const selected = activeTab === tab.status;
            return (
              <button
                key={tab.status}
                id={tabId(tab.status)}
                role="tab"
                type="button"
                aria-selected={selected}
                aria-controls={panelId(tab.status)}
                // Roving tabindex: Tab reaches the tablist once, arrow keys
                // move within it (WAI-ARIA tabs pattern).
                tabIndex={selected ? 0 : -1}
                onClick={() => setActiveTab(tab.status)}
                onKeyDown={handleTabKeyDown}
                className={`pb-2 -mb-px text-sm font-medium border-b-2 transition-colors ${
                  selected
                    ? "border-amber-600 text-amber-700"
                    : "border-transparent text-stone-500 hover:text-stone-700"
                }`}
              >
                {tab.label}{" "}
                <span className="text-xs text-stone-400">
                  ({byStatus[tab.status].length})
                </span>
              </button>
            );
          })}
        </div>
      )}

      {ordered.length > 0 && (
        <p
          className="mt-2 text-xs text-stone-500"
          role="status"
          aria-live="polite"
        >
          {ordered.length} {ordered.length === 1 ? "recipe" : "recipes"}
        </p>
      )}

      {allTags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {allTags.map((tag) => {
            const active = selectedTags.has(tag);
            return (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={`text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded border transition-colors ${
                  active
                    ? "bg-amber-600 text-white border-amber-600"
                    : "bg-stone-100 text-stone-600 border-stone-200 hover:border-amber-400 hover:text-amber-700"
                }`}
              >
                {tag}
              </button>
            );
          })}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="mt-6 text-center text-sm text-stone-500 border border-dashed border-stone-300 rounded-xl py-10 px-4">
          No recipes match your search or filters.{" "}
          <button
            onClick={() => {
              setQuery("");
              setSelectedTags(new Set());
            }}
            className="text-amber-700 hover:text-amber-800 underline"
          >
            Clear filters
          </button>
        </div>
      ) : ordered.length === 0 ? (
        <div className="mt-6 text-center text-sm text-stone-500 border border-dashed border-stone-300 rounded-xl py-10 px-4">
          {activeTab === "tried_and_tested"
            ? "No tried & tested recipes match yet — check the Want to Try tab."
            : "Nothing waiting to be tried — everything's been tried & tested."}
        </div>
      ) : (
        <div
          {...(isAdmin
            ? {
                id: panelId(activeTab),
                role: "tabpanel",
                "aria-labelledby": tabId(activeTab),
              }
            : {})}
          className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {ordered.map((summary) => (
            // Card is a plain container; the title is the real link. The
            // delete button is a sibling (not nested in an <a>), keeping the
            // markup valid.
            <div
              key={summary.id}
              className="group relative flex flex-col p-4 bg-white border border-stone-200 rounded-xl hover:border-amber-400 hover:shadow-sm transition-all"
            >
              {/* Full-card overlay link for easy clicking; sits beneath the button. */}
              <Link
                href={`/recipes/${summary.id}`}
                className="absolute inset-0 rounded-xl"
                aria-label={summary.title}
              />

              {isAdmin && (
                <button
                  onClick={(e) => handleDelete(e, summary)}
                  disabled={busyId === summary.id}
                  className="absolute top-2 right-2 z-10 text-stone-300 hover:text-red-500 transition-colors text-lg leading-none disabled:opacity-40"
                  aria-label={`Delete ${summary.title}`}
                >
                  ×
                </button>
              )}

              <div className="font-medium text-sm text-stone-900 pr-5 line-clamp-2">
                {summary.title}
              </div>

              <div className="text-xs text-stone-500 mt-1">
                {summary.ingredient_count} ingredients · base{" "}
                {summary.base_servings} servings
                {summary.has_instructions ? " · steps saved" : ""}
              </div>

              {(summary.edited ||
                summary.has_notes ||
                (isAdmin && summary.status === "saved_for_later")) && (
                <div className="mt-2 flex gap-1.5">
                  {/* Non-admins only ever receive tried_and_tested rows, so
                      this toggle never renders for them. */}
                  {isAdmin && summary.status === "saved_for_later" && (
                    <button
                      onClick={(e) => handleToggleStatus(e, summary)}
                      disabled={busyId === summary.id}
                      title="Mark as tried & tested"
                      className="relative z-10 text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 border border-stone-200 hover:border-amber-400 hover:text-amber-700 transition-colors disabled:opacity-40"
                    >
                      Saved for later
                    </button>
                  )}
                  {summary.edited && (
                    <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                      Customized
                    </span>
                  )}
                  {summary.has_notes && (
                    <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 border border-stone-200">
                      Notes
                    </span>
                  )}
                </div>
              )}

              {summary.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {summary.tags.slice(0, MAX_VISIBLE_TAGS).map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200"
                    >
                      {tag}
                    </span>
                  ))}
                  {summary.tags.length > MAX_VISIBLE_TAGS && (
                    <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-stone-100 text-stone-500 border border-stone-200">
                      +{summary.tags.length - MAX_VISIBLE_TAGS}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
