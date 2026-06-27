"use client";

/**
 * AddRecipeForm — import a recipe into the library from a URL.
 *
 * POSTs to /api/extract (SSE stream), shows live status messages while
 * extracting, then navigates to the new recipe's detail page.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Recipe } from "@/types";

export default function AddRecipeForm() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleAdd() {
    const u = url.trim();
    if (!u || loading) return;
    setLoading(true);
    setError(null);
    setStatusMsg(null);

    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: u }),
      });

      // Pre-stream validation errors return plain JSON with a non-200 status.
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Couldn't import that recipe");
        return;
      }

      // Read the SSE stream.
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const event of events) {
          const line = event.trim();
          if (!line.startsWith("data: ")) continue;
          const payload = JSON.parse(line.slice(6));

          if (payload.type === "status") {
            setStatusMsg(payload.message);
          } else if (payload.type === "result") {
            const recipe = payload.recipe as Recipe;
            if (payload.saved && recipe?.id) {
              setUrl("");
              router.push(`/recipes/${recipe.id}`);
            } else {
              setError(
                "Imported the recipe, but couldn't save it to your library (database unavailable). Try again shortly."
              );
            }
            break outer;
          } else if (payload.type === "error") {
            setError(payload.error ?? "Couldn't import that recipe");
            break outer;
          }
        }
      }
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
      setStatusMsg(null);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4">
      <label className="block text-sm font-medium text-stone-700 mb-1">
        Add a recipe by URL
      </label>
      <p className="text-xs text-stone-500 mb-2">
        A recipe website, or an Instagram reel whose caption or audio has the
        full recipe.
      </p>
      <div className="flex gap-2 items-stretch flex-wrap">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="https://recipetineats.com/… or instagram.com/reel/…"
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
      {loading && statusMsg && (
        <p className="text-xs text-stone-500 mt-2">{statusMsg}</p>
      )}
      {error && <p className="text-sm text-red-600 mt-2">⚠️ {error}</p>}
    </div>
  );
}
