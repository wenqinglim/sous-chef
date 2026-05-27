"use client";

/**
 * RecipeForm — Step 1 of the UI.
 *
 * Allows the user to add multiple recipe URLs with desired serving sizes.
 * Each row shows a URL input + servings selector.
 * When the user clicks "Add Recipe", the app fetches metadata from /api/extract.
 * Fetched recipes show their title + ingredient count as confirmation.
 */

import { useState } from "react";
import type { Recipe } from "@/types";

interface RecipeRow {
  url: string;
  targetServings: number;
  recipe: Recipe | null;
  loading: boolean;
  error: string | null;
}

interface Props {
  rows: RecipeRow[];
  onRowsChange: (rows: RecipeRow[]) => void;
}

export default function RecipeForm({ rows, onRowsChange }: Props) {
  const [urlInput, setUrlInput] = useState("");
  const [servingsInput, setServingsInput] = useState(4);

  async function handleAddRecipe() {
    const url = urlInput.trim();
    if (!url) return;

    const newRow: RecipeRow = {
      url,
      targetServings: servingsInput,
      recipe: null,
      loading: true,
      error: null,
    };

    const newRows = [...rows, newRow];
    const idx = newRows.length - 1;
    onRowsChange(newRows);
    setUrlInput("");

    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      const data = await res.json();

      if (!res.ok) {
        const updated = [...newRows];
        updated[idx] = {
          ...updated[idx],
          loading: false,
          error: data.error ?? "Failed to fetch recipe",
        };
        onRowsChange(updated);
        return;
      }

      const updated = [...newRows];
      updated[idx] = {
        ...updated[idx],
        loading: false,
        recipe: data.recipe as Recipe,
      };
      onRowsChange(updated);
    } catch {
      const updated = [...newRows];
      updated[idx] = {
        ...updated[idx],
        loading: false,
        error: "Network error — please try again",
      };
      onRowsChange(updated);
    }
  }

  function handleRemoveRow(idx: number) {
    onRowsChange(rows.filter((_, i) => i !== idx));
  }

  function handleServingsChange(idx: number, servings: number) {
    const updated = [...rows];
    updated[idx] = { ...updated[idx], targetServings: servings };
    onRowsChange(updated);
  }

  return (
    <div className="space-y-4">
      {/* URL input row */}
      <div className="flex gap-2 items-end flex-wrap">
        <div className="flex-1 min-w-60">
          <label className="block text-sm font-medium text-stone-700 mb-1">
            Recipe URL
          </label>
          <input
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddRecipe()}
            placeholder="https://recipetineats.com/..."
            className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>
        <div className="w-28">
          <label className="block text-sm font-medium text-stone-700 mb-1">
            Servings
          </label>
          <input
            type="number"
            min={1}
            max={50}
            value={servingsInput}
            onChange={(e) => setServingsInput(parseInt(e.target.value) || 1)}
            className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>
        <button
          onClick={handleAddRecipe}
          disabled={!urlInput.trim()}
          className="px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Add Recipe
        </button>
      </div>

      {/* Recipe cards */}
      {rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((row, idx) => (
            <div
              key={idx}
              className="flex items-start gap-3 p-3 bg-white border border-stone-200 rounded-lg"
            >
              <div className="flex-1 min-w-0">
                {row.loading && (
                  <div className="flex items-center gap-2 text-sm text-stone-500">
                    <span className="animate-spin">⏳</span>
                    <span>Fetching recipe…</span>
                  </div>
                )}
                {row.error && (
                  <div className="text-sm text-red-600">
                    ⚠️ {row.error}
                    <div className="text-xs text-stone-400 truncate mt-0.5">
                      {row.url}
                    </div>
                  </div>
                )}
                {row.recipe && (
                  <div>
                    <div className="font-medium text-sm text-stone-900 truncate">
                      {row.recipe.title}
                    </div>
                    <div className="text-xs text-stone-500 mt-0.5">
                      {row.recipe.ingredients.length} ingredients · base{" "}
                      {row.recipe.base_servings} servings
                    </div>
                  </div>
                )}
                {!row.loading && !row.error && !row.recipe && (
                  <div className="text-xs text-stone-400 truncate">{row.url}</div>
                )}
              </div>

              {/* Servings adjuster (only when recipe loaded) */}
              {row.recipe && (
                <div className="flex items-center gap-1 text-sm">
                  <button
                    onClick={() =>
                      handleServingsChange(idx, Math.max(1, row.targetServings - 1))
                    }
                    className="w-6 h-6 flex items-center justify-center rounded border border-stone-300 text-stone-600 hover:bg-stone-100"
                  >
                    −
                  </button>
                  <span className="w-8 text-center text-stone-700">
                    {row.targetServings}
                  </span>
                  <button
                    onClick={() => handleServingsChange(idx, row.targetServings + 1)}
                    className="w-6 h-6 flex items-center justify-center rounded border border-stone-300 text-stone-600 hover:bg-stone-100"
                  >
                    +
                  </button>
                  <span className="ml-1 text-xs text-stone-400">servings</span>
                </div>
              )}

              {/* Remove button */}
              <button
                onClick={() => handleRemoveRow(idx)}
                className="text-stone-400 hover:text-red-500 transition-colors text-lg leading-none"
                aria-label="Remove recipe"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export type { RecipeRow };
