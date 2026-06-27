"use client";

/**
 * AddRecipeForm — import a recipe into the library from a URL.
 *
 * POSTs to /api/extract (SSE stream), shows live status messages while
 * extracting, then navigates to the new recipe's detail page.
 *
 * Instagram reels are fetched via a third-party scraper; when that can't read a
 * reel, the user can expand "Paste the caption instead" and submit the caption
 * text directly (same SSE endpoint, `text` body) — a $0 fallback that can't be
 * IP-blocked. The paste box also auto-opens when an import errors.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Recipe } from "@/types";

export default function AddRecipeForm() {
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  /**
   * POST to /api/extract and drive the SSE stream to completion. Shared by both
   * the URL import and the paste-caption fallback. Returns true on success
   * (navigation triggered), false on any error (message set via setError).
   */
  async function runExtract(payload: { url?: string; text?: string }): Promise<boolean> {
    const res = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    // Pre-stream validation errors return plain JSON with a non-200 status.
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Couldn't import that recipe");
      return false;
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const event of events) {
        const line = event.trim();
        if (!line.startsWith("data: ")) continue;
        const evt = JSON.parse(line.slice(6));

        if (evt.type === "status") {
          setStatusMsg(evt.message);
        } else if (evt.type === "result") {
          const recipe = evt.recipe as Recipe;
          if (evt.saved && recipe?.id) {
            router.push(`/recipes/${recipe.id}`);
            return true;
          }
          setError(
            "Imported the recipe, but couldn't save it to your library (database unavailable). Try again shortly."
          );
          return false;
        } else if (evt.type === "error") {
          setError(evt.error ?? "Couldn't import that recipe");
          return false;
        }
      }
    }
    return false;
  }

  async function handleAdd() {
    const u = url.trim();
    if (!u || loading) return;
    setLoading(true);
    setError(null);
    setStatusMsg(null);

    try {
      const ok = await runExtract({ url: u });
      if (ok) {
        setUrl("");
        setCaption("");
        setShowPaste(false);
      } else {
        // Reveal the manual fallback so the user has an immediate next step.
        setShowPaste(true);
      }
    } catch {
      setError("Network error — please try again");
      setShowPaste(true);
    } finally {
      setLoading(false);
      setStatusMsg(null);
    }
  }

  async function handlePaste() {
    const text = caption.trim();
    if (!text || loading) return;
    setLoading(true);
    setError(null);
    setStatusMsg(null);

    try {
      // Send the URL too when present, so the recipe links back to (and dedupes
      // against) the reel; the backend skips fetching whenever `text` is given.
      const u = url.trim();
      const ok = await runExtract(u ? { url: u, text } : { text });
      if (ok) {
        setUrl("");
        setCaption("");
        setShowPaste(false);
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

      {/* Manual caption-paste fallback — for reels the scraper can't read. */}
      <div className="mt-3 border-t border-stone-100 pt-3">
        {!showPaste ? (
          <button
            type="button"
            onClick={() => setShowPaste(true)}
            className="text-xs text-stone-500 hover:text-stone-700 underline"
          >
            Paste the caption instead
          </button>
        ) : (
          <div>
            <label className="block text-xs font-medium text-stone-700 mb-1">
              Paste the reel&apos;s caption / recipe text
            </label>
            <p className="text-xs text-stone-500 mb-2">
              If automatic import fails, open the reel, copy its caption, and
              paste it here. Keep the URL above filled in so the recipe links
              back to the reel.
            </p>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={5}
              placeholder="Ingredients: 200g noodles, 3 tbsp butter… Method: …"
              className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={handlePaste}
                disabled={!caption.trim() || loading}
                className="px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
              >
                {loading ? "Importing…" : "Import from caption"}
              </button>
              <button
                type="button"
                onClick={() => setShowPaste(false)}
                disabled={loading}
                className="px-3 py-2 text-sm text-stone-500 hover:text-stone-700"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
