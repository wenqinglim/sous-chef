"use client";

/**
 * IngredientsReview — Step 2 of the UI.
 *
 * Shows the parsed ingredients from all recipes for user confirmation/editing
 * before the grocery list is generated.
 *
 * This is the "manual edit step" from the architecture doc. Parsing fails
 * more often than you'd think — showing users their ingredients lets them
 * catch problems early.
 */

import { useState } from "react";
import type { Recipe } from "@/types";
import type { RecipeRow } from "./RecipeForm";

interface IngredientLine {
  recipeTitle: string;
  raw_text: string;
  enabled: boolean;
}

interface Props {
  rows: RecipeRow[];
  onConfirm: (rows: RecipeRow[]) => void;
  onBack: () => void;
  loading: boolean;
}

export default function IngredientsReview({ rows, onConfirm, onBack, loading }: Props) {
  // Flatten all ingredients across all loaded recipes
  const [lines, setLines] = useState<IngredientLine[]>(() => {
    const result: IngredientLine[] = [];
    for (const row of rows) {
      if (!row.recipe) continue;
      for (const ing of row.recipe.ingredients) {
        result.push({
          recipeTitle: row.recipe.title,
          raw_text: ing.raw_text,
          enabled: true,
        });
      }
    }
    return result;
  });

  function toggleLine(idx: number) {
    setLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, enabled: !l.enabled } : l))
    );
  }

  function handleConfirm() {
    // Build updated rows with disabled ingredients removed
    const enabledTexts = new Set(
      lines.filter((l) => l.enabled).map((l) => l.raw_text)
    );

    const updatedRows = rows.map((row) => {
      if (!row.recipe) return row;
      return {
        ...row,
        recipe: {
          ...row.recipe,
          ingredients: row.recipe.ingredients.filter((ing) =>
            enabledTexts.has(ing.raw_text)
          ),
        },
      };
    });

    onConfirm(updatedRows);
  }

  // Group lines by recipe
  const grouped = lines.reduce<Record<string, IngredientLine[]>>(
    (acc, line) => {
      if (!acc[line.recipeTitle]) acc[line.recipeTitle] = [];
      acc[line.recipeTitle].push(line);
      return acc;
    },
    {}
  );

  const enabledCount = lines.filter((l) => l.enabled).length;

  return (
    <div className="space-y-4">
      <div className="text-sm text-stone-600">
        Review your ingredients before generating the list. Uncheck anything
        that doesn&apos;t look right.
      </div>

      {/* Ingredient list by recipe */}
      <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
        {Object.entries(grouped).map(([title, recipeLines]) => {
          const lineIdxOffset = lines.findIndex((l) => l.recipeTitle === title);
          return (
            <div key={title}>
              <div className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-1.5">
                {title}
              </div>
              <div className="space-y-1">
                {recipeLines.map((line, relIdx) => {
                  const absIdx = lineIdxOffset + relIdx;
                  return (
                    <label
                      key={absIdx}
                      className="flex items-start gap-2 cursor-pointer group"
                    >
                      <input
                        type="checkbox"
                        checked={line.enabled}
                        onChange={() => toggleLine(absIdx)}
                        className="mt-0.5 h-4 w-4 rounded border-stone-300 text-amber-600 focus:ring-amber-500"
                      />
                      <span
                        className={`text-sm leading-snug ${
                          line.enabled
                            ? "text-stone-800"
                            : "text-stone-400 line-through"
                        }`}
                      >
                        {line.raw_text}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2 border-t border-stone-100">
        <button
          onClick={onBack}
          className="px-4 py-2 text-sm text-stone-600 border border-stone-300 rounded-lg hover:bg-stone-50 transition-colors"
        >
          ← Back
        </button>
        <button
          onClick={handleConfirm}
          disabled={enabledCount === 0 || loading}
          className="flex-1 px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading
            ? "Building list…"
            : `Looks good — build my list (${enabledCount} ingredients)`}
        </button>
      </div>
    </div>
  );
}
