"use client";

/**
 * RecipeDetail — expandable view of a saved recipe.
 *
 * Shows the ingredient list (raw text) and numbered cooking steps.
 * Used inside library entries and on loaded recipe cards.
 */

import type { Recipe } from "@/types";
import { groupBySection, normalizeInstructions } from "@/lib/recipe/sections";

interface Props {
  recipe: Recipe;
}

export default function RecipeDetail({ recipe }: Props) {
  // Recipes cached before cooking steps existed may lack the field; older
  // caches also stored instructions as plain strings — coerce either way.
  const instructions = normalizeInstructions(recipe.instructions);
  const ingredientGroups = groupBySection(recipe.ingredients, (i) => i.section);
  const instructionGroups = groupBySection(instructions, (s) => s.section);
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
          <div className="space-y-2">
            {ingredientGroups.map((group, gi) => (
              <div key={gi}>
                {group.section && (
                  <p className="text-xs font-medium text-stone-700">
                    {group.section}
                  </p>
                )}
                <ul className="list-disc list-inside space-y-0.5 text-stone-700">
                  {group.items.map((ing, i) => (
                    <li key={i}>{ing.raw_text}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h4 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1">
            Steps
          </h4>
          {instructions.length > 0 ? (
            <div className="space-y-2">
              {instructionGroups.map((group, gi) => (
                <div key={gi}>
                  {group.section && (
                    <p className="text-xs font-medium text-stone-700">
                      {group.section}
                    </p>
                  )}
                  <ol className="list-decimal list-inside space-y-1 text-stone-700">
                    {group.items.map((step, i) => (
                      <li key={i}>{step.text}</li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
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
