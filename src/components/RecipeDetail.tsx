"use client";

/**
 * RecipeDetail — expandable view of a saved recipe.
 *
 * Shows the ingredient list (raw text) and numbered cooking steps.
 * Used inside library entries and on loaded recipe cards.
 */

import type { Recipe } from "@/types";

interface Props {
  recipe: Recipe;
}

export default function RecipeDetail({ recipe }: Props) {
  // Recipes cached before cooking steps existed may lack the field
  const instructions = recipe.instructions ?? [];
  return (
    <details className="group mt-2">
      <summary className="text-xs text-amber-700 hover:text-amber-800 cursor-pointer select-none list-none">
        <span className="group-open:hidden">View recipe ▸</span>
        <span className="hidden group-open:inline">Hide recipe ▾</span>
      </summary>

      <div className="mt-2 space-y-3 text-sm">
        <div>
          <h4 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1">
            Ingredients
          </h4>
          <ul className="list-disc list-inside space-y-0.5 text-stone-700">
            {recipe.ingredients.map((ing, i) => (
              <li key={i}>{ing.raw_text}</li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1">
            Steps
          </h4>
          {instructions.length > 0 ? (
            <ol className="list-decimal list-inside space-y-1 text-stone-700">
              {instructions.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          ) : (
            <p className="text-xs text-stone-400">
              No cooking steps saved for this recipe.
            </p>
          )}
        </div>
      </div>
    </details>
  );
}
