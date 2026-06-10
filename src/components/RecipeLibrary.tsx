"use client";

/**
 * RecipeLibrary — saved-recipe picker, shown alongside the URL input.
 *
 * Lists recipes from the shared library (GET /api/recipes); picking one
 * fetches the full document and pushes it into the meal-plan rows without
 * re-extracting the URL. The library being unreachable must never break the
 * URL-input flow — errors degrade to a muted message.
 */

import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Recipe } from "@/types";
import type { RecipeRow } from "@/components/RecipeForm";
import { normalizeUrl } from "@/lib/normalize-url";

interface RecipeSummary {
  id: string;
  url: string;
  title: string;
  base_servings: number;
  ingredient_count: number;
  has_instructions: boolean;
  created_at: string;
}

interface Props {
  rows: RecipeRow[];
  onRowsChange: Dispatch<SetStateAction<RecipeRow[]>>;
}

export default function RecipeLibrary({ rows, onRowsChange }: Props) {
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
        if (!cancelled) setError("Saved recipes are unavailable right now.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Library urls are stored normalized, but a row's url may be the raw
  // user-typed string (e.g. when extract couldn't save) — compare on the
  // canonical id first, normalized url as fallback.
  const rowIds = new Set(rows.map((r) => r.recipe?.id).filter(Boolean));
  const rowUrls = new Set(
    rows.map((r) => normalizeUrl(r.recipe?.url ?? r.url)).filter(Boolean)
  );

  async function handleAdd(summary: RecipeSummary) {
    setError(null);
    setBusyId(summary.id);
    try {
      const res = await fetch(`/api/recipes/${summary.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load recipe");
      const recipe = data.recipe as Recipe;
      onRowsChange((prev) => [
        ...prev,
        {
          url: recipe.url,
          targetServings: recipe.base_servings,
          recipe,
          loading: false,
          error: null,
        },
      ]);
    } catch {
      setError("Couldn't load that recipe — try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(summary: RecipeSummary) {
    if (!window.confirm(`Delete "${summary.title}" from your saved recipes?`)) {
      return;
    }
    setError(null);
    setBusyId(summary.id);
    try {
      const res = await fetch(`/api/recipes/${summary.id}`, {
        method: "DELETE",
      });
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

  // Library empty or unreachable — stay quiet and small; the URL flow is primary
  if (error && !summaries) {
    return <p className="text-xs text-stone-400 mt-4">{error}</p>;
  }
  if (!summaries || summaries.length === 0) return null;

  return (
    <div className="mt-6 pt-4 border-t border-stone-100">
      <h3 className="text-sm font-medium text-stone-700 mb-2">
        Or pick from your saved recipes
      </h3>
      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
      <div className="space-y-2">
        {summaries.map((summary) => {
          const alreadyAdded =
            rowIds.has(summary.id) || rowUrls.has(summary.url);
          return (
            <div
              key={summary.id}
              className="flex items-center gap-3 p-3 bg-stone-50 border border-stone-200 rounded-lg"
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-stone-900 truncate">
                  {summary.title}
                </div>
                <div className="text-xs text-stone-500 mt-0.5">
                  {summary.ingredient_count} ingredients · base{" "}
                  {summary.base_servings} servings
                  {summary.has_instructions ? " · steps saved" : ""}
                </div>
              </div>
              <button
                onClick={() => handleAdd(summary)}
                disabled={alreadyAdded || busyId === summary.id}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-amber-600 text-amber-700 hover:bg-amber-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {alreadyAdded ? "Added" : "Add to plan"}
              </button>
              <button
                onClick={() => handleDelete(summary)}
                disabled={busyId === summary.id}
                className="text-stone-400 hover:text-red-500 transition-colors text-lg leading-none disabled:opacity-40"
                aria-label={`Delete ${summary.title}`}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
