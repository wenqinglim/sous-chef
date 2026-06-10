"use client";

/**
 * AddRecipeForm — import a recipe into the library from a URL.
 *
 * POSTs to /api/extract (which auto-saves), then navigates to the new recipe's
 * detail page. If the DB is unreachable the recipe can't be saved/viewed, so we
 * surface that instead of routing to a 404.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Recipe } from "@/types";

export default function AddRecipeForm() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleAdd() {
    const u = url.trim();
    if (!u || loading) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: u }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Couldn't import that recipe");
        return;
      }

      const recipe = data.recipe as Recipe;
      if (data.saved && recipe?.id) {
        setUrl("");
        router.push(`/recipes/${recipe.id}`);
      } else {
        // Extraction worked but the library DB is down — nothing to open.
        setError(
          "Imported the recipe, but couldn't save it to your library (database unavailable). Try again shortly."
        );
      }
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4">
      <label className="block text-sm font-medium text-stone-700 mb-1">
        Add a recipe by URL
      </label>
      <div className="flex gap-2 items-stretch flex-wrap">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="https://recipetineats.com/..."
          className="flex-1 min-w-60 border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
        />
        <button
          onClick={handleAdd}
          disabled={!url.trim() || loading}
          className="px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
        >
          {loading ? "Importing…" : "Add recipe"}
        </button>
      </div>
      {error && <p className="text-sm text-red-600 mt-2">⚠️ {error}</p>}
    </div>
  );
}
