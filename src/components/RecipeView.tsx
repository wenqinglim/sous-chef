"use client";

/**
 * RecipeView — read-only detail of a saved recipe.
 *
 * Shows ingredients, numbered steps, and user notes, with a link back to the
 * original source and a one-click "Add to grocery list". A later change adds a
 * "Customize" button that swaps in an editor.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Recipe } from "@/types";
import { addToMealPlan } from "@/lib/storage/localStorage";
import { rescaleIngredientLine } from "@/lib/units/rescale";

interface Props {
  recipe: Recipe;
  onCustomize: () => void;
}

export default function RecipeView({ recipe, onCustomize }: Props) {
  const router = useRouter();
  const [added, setAdded] = useState(false);
  const [viewServings, setViewServings] = useState(recipe.base_servings);
  const instructions = recipe.instructions ?? [];
  const notes = recipe.notes?.trim();

  const scaleFactor = viewServings / recipe.base_servings;
  const isScaled = viewServings !== recipe.base_servings;

  function handleAddToGroceryList() {
    addToMealPlan(recipe, viewServings);
    setAdded(true);
    router.push("/grocery-list");
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <Link href="/" className="text-sm text-stone-500 hover:text-stone-700">
        ← Back to recipes
      </Link>

      <article className="mt-4 bg-white rounded-xl border border-stone-200 shadow-sm p-6">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold text-stone-900">{recipe.title}</h1>
          {recipe.edited && (
            <span className="shrink-0 mt-1 text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
              Customized
            </span>
          )}
        </div>

        <div className="mt-1 text-sm text-stone-500">
          Base {recipe.base_servings} servings
        </div>

        <div className="mt-3 flex items-center gap-2 text-sm">
          <span className="text-xs text-stone-500">Scale to:</span>
          <button
            onClick={() => setViewServings(Math.max(1, viewServings - 1))}
            className="w-6 h-6 flex items-center justify-center rounded border border-stone-300 text-stone-600 hover:bg-stone-100"
            aria-label="Decrease servings"
          >
            −
          </button>
          <input
            type="number"
            min={1}
            max={100}
            value={viewServings}
            onChange={(e) =>
              setViewServings(
                Math.min(100, Math.max(1, parseInt(e.target.value) || 1))
              )
            }
            className="w-14 text-center border border-stone-300 rounded px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500"
            aria-label="Servings"
          />
          <button
            onClick={() => setViewServings(Math.min(100, viewServings + 1))}
            className="w-6 h-6 flex items-center justify-center rounded border border-stone-300 text-stone-600 hover:bg-stone-100"
            aria-label="Increase servings"
          >
            +
          </button>
          <span className="text-xs text-stone-400">servings</span>
          {isScaled && (
            <button
              onClick={() => setViewServings(recipe.base_servings)}
              className="ml-1 text-xs text-amber-700 hover:text-amber-800 underline"
            >
              Reset
            </button>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {recipe.url && (
            <a
              href={recipe.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-amber-700 hover:text-amber-800"
            >
              View original recipe ↗
            </a>
          )}
          <button
            onClick={handleAddToGroceryList}
            disabled={added}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
          >
            🛒 Add to grocery list
          </button>
          <button
            onClick={onCustomize}
            className="px-3 py-1.5 text-sm font-medium rounded-lg border border-stone-300 text-stone-700 hover:bg-stone-50 transition-colors"
          >
            ✏️ Customize
          </button>
        </div>

        {notes && (
          <section className="mt-6">
            <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1">
              Notes
            </h2>
            <p className="text-sm text-stone-700 whitespace-pre-wrap">{notes}</p>
          </section>
        )}

        <section className="mt-6">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
              Ingredients
            </h2>
            {isScaled && (
              <span className="text-xs text-amber-700">
                scaled for {viewServings} servings · not saved
              </span>
            )}
          </div>
          <ul className="list-disc list-inside space-y-1 text-sm text-stone-700">
            {recipe.ingredients.map((ing, i) => (
              <li key={i}>
                {isScaled
                  ? rescaleIngredientLine(ing.raw_text, scaleFactor)
                  : ing.raw_text}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-6">
          <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">
            Steps
          </h2>
          {instructions.length > 0 ? (
            <ol className="list-decimal list-inside space-y-2 text-sm text-stone-700">
              {instructions.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-stone-400">
              No cooking steps saved for this recipe.
            </p>
          )}
        </section>
      </article>
    </main>
  );
}
