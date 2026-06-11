"use client";

/**
 * RecipeLibraryGrid — the home-page recipe library.
 *
 * Lists saved recipes (GET /api/recipes) as cards that link into the detail
 * page. Delete happens in place. The library being unreachable degrades to a
 * muted message rather than an error wall.
 */

import { useEffect, useState } from "react";
import Link from "next/link";

interface RecipeSummary {
  id: string;
  url: string;
  title: string;
  base_servings: number;
  ingredient_count: number;
  has_instructions: boolean;
  edited: boolean;
  has_notes: boolean;
  created_at: string;
}

export default function RecipeLibraryGrid() {
  const [summaries, setSummaries] = useState<RecipeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/recipes");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load library");
        if (!cancelled) setSummaries(data.recipes);
      } catch {
        if (!cancelled) setError("Your saved recipes are unavailable right now.");
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

  if (error && !summaries) {
    return <p className="text-sm text-stone-400 mt-6">{error}</p>;
  }

  if (!summaries) {
    return <p className="text-sm text-stone-400 mt-6">Loading your recipes…</p>;
  }

  if (summaries.length === 0) {
    return (
      <div className="mt-6 text-center text-sm text-stone-500 border border-dashed border-stone-300 rounded-xl py-10 px-4">
        No saved recipes yet. Paste a recipe URL above to start your library.
      </div>
    );
  }

  return (
    <div className="mt-6">
      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {summaries.map((summary) => (
          // Card is a plain container; the title is the real link. The delete
          // button is a sibling (not nested in an <a>), keeping the markup valid.
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

            <button
              onClick={(e) => handleDelete(e, summary)}
              disabled={busyId === summary.id}
              className="absolute top-2 right-2 z-10 text-stone-300 hover:text-red-500 transition-colors text-lg leading-none disabled:opacity-40"
              aria-label={`Delete ${summary.title}`}
            >
              ×
            </button>

            <div className="font-medium text-sm text-stone-900 pr-5 line-clamp-2">
              {summary.title}
            </div>

            <div className="text-xs text-stone-500 mt-1">
              {summary.ingredient_count} ingredients · base{" "}
              {summary.base_servings} servings
              {summary.has_instructions ? " · steps saved" : ""}
            </div>

            {(summary.edited || summary.has_notes) && (
              <div className="mt-2 flex gap-1.5">
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
          </div>
        ))}
      </div>
    </div>
  );
}
