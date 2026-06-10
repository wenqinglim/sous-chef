"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import RecipeForm, { type RecipeRow } from "@/components/RecipeForm";
import RecipeLibrary from "@/components/RecipeLibrary";
import IngredientsReview from "@/components/IngredientsReview";
import GroceryList from "@/components/GroceryList";
import {
  loadMealPlan,
  saveMealPlan,
  loadRecipes,
  saveRecipes,
} from "@/lib/storage/localStorage";
import type { MealPlan, Recipe, PurchaseItem, UnresolvableIngredient } from "@/types";
import { v4 as uuidv4 } from "uuid";

type Step = "input" | "review" | "output";

interface OutputState {
  items: PurchaseItem[];
  unresolvable: UnresolvableIngredient[];
  grouped_by_aisle: Record<string, PurchaseItem[]>;
}

export default function GroceryListPage() {
  const [step, setStep] = useState<Step>("input");
  const [rows, setRows] = useState<RecipeRow[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [output, setOutput] = useState<OutputState | null>(null);

  // Restore from localStorage on mount
  useEffect(() => {
    const savedPlan = loadMealPlan();
    const savedRecipes = loadRecipes();

    if (savedPlan.recipes.length > 0 && savedRecipes.size > 0) {
      // Re-hydrate rows from storage
      const restoredRows: RecipeRow[] = savedPlan.recipes
        .map((entry) => {
          const recipe = savedRecipes.get(entry.recipe_id);
          if (!recipe) return null;
          return {
            url: recipe.url,
            targetServings: entry.target_servings,
            recipe,
            loading: false,
            error: null,
          };
        })
        .filter(Boolean) as RecipeRow[];

      if (restoredRows.length > 0) {
        setRows(restoredRows);
      }
    }
  }, []);

  // Persist to localStorage whenever rows change
  useEffect(() => {
    const loadedRows = rows.filter((r) => r.recipe !== null);
    if (loadedRows.length === 0) return;

    const recipeMap = new Map<string, Recipe>();
    const planEntries: MealPlan["recipes"] = [];

    for (const row of loadedRows) {
      if (!row.recipe) continue;
      recipeMap.set(row.recipe.id, row.recipe);
      planEntries.push({
        recipe_id: row.recipe.id,
        target_servings: row.targetServings,
      });
    }

    const plan: MealPlan = { id: uuidv4(), name: null, recipes: planEntries };
    saveMealPlan(plan);
    saveRecipes(recipeMap);
  }, [rows]);

  const loadedRows = rows.filter((r) => r.recipe !== null);
  const canProceedToReview =
    loadedRows.length > 0 && rows.every((r) => !r.loading);

  async function handleGenerateList(confirmedRows: RecipeRow[]) {
    setReviewLoading(true);
    setReviewError(null);

    try {
      const recipes = confirmedRows
        .filter((r) => r.recipe !== null)
        .map((r) => r.recipe!);

      const mealPlanEntries = confirmedRows
        .filter((r) => r.recipe !== null)
        .map((r) => ({
          recipe_id: r.recipe!.id,
          target_servings: r.targetServings,
        }));

      const mealPlan: MealPlan = {
        id: uuidv4(),
        name: null,
        recipes: mealPlanEntries,
      };

      const res = await fetch("/api/grocery-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mealPlan, recipes }),
      });

      if (!res.ok) {
        const data = await res.json();
        setReviewError(data.error ?? "Failed to generate grocery list");
        return;
      }

      const data = await res.json();
      setOutput({
        items: data.items,
        unresolvable: data.unresolvable,
        grouped_by_aisle: data.grouped_by_aisle,
      });
      setStep("output");
    } catch (err) {
      setReviewError(
        err instanceof Error ? err.message : "Failed to generate grocery list"
      );
    } finally {
      setReviewLoading(false);
    }
  }

  function handleReset() {
    setRows([]);
    setOutput(null);
    setStep("input");
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <Link
        href="/"
        className="inline-block text-sm text-stone-500 hover:text-stone-700 mb-4"
      >
        ← Back to recipes
      </Link>

      <h1 className="text-xl font-semibold text-stone-900 mb-1">Grocery list</h1>
      <p className="text-sm text-stone-500 mb-6">
        Pick recipes (from your library or a URL), scale the servings, and copy a
        consolidated checklist.
      </p>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6 text-xs text-stone-400">
        <span className={step === "input" ? "text-amber-600 font-semibold" : ""}>
          1. Add recipes
        </span>
        <span>→</span>
        <span className={step === "review" ? "text-amber-600 font-semibold" : ""}>
          2. Confirm ingredients
        </span>
        <span>→</span>
        <span className={step === "output" ? "text-amber-600 font-semibold" : ""}>
          3. Grocery list
        </span>
      </div>

      {/* Card */}
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-6">
        {step === "input" && (
          <>
            <h2 className="font-semibold text-stone-900 mb-4">Add your recipes</h2>
            <RecipeForm rows={rows} onRowsChange={setRows} />
            <RecipeLibrary rows={rows} onRowsChange={setRows} />

            {canProceedToReview && (
              <div className="mt-4 pt-4 border-t border-stone-100">
                <button
                  onClick={() => {
                    setStep("review");
                    setReviewError(null);
                  }}
                  className="w-full px-4 py-2.5 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 transition-colors"
                >
                  Review ingredients ({loadedRows.length} recipe
                  {loadedRows.length !== 1 ? "s" : ""}) →
                </button>
              </div>
            )}
          </>
        )}

        {step === "review" && (
          <>
            <h2 className="font-semibold text-stone-900 mb-4">
              Confirm ingredients
            </h2>
            <IngredientsReview
              rows={rows}
              onConfirm={handleGenerateList}
              onBack={() => setStep("input")}
              loading={reviewLoading}
            />
            {reviewError && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                ⚠️ {reviewError}
              </div>
            )}
          </>
        )}

        {step === "output" && output && (
          <>
            <h2 className="font-semibold text-stone-900 mb-4">
              Your grocery list
            </h2>
            <GroceryList
              items={output.items}
              unresolvable={output.unresolvable}
              grouped_by_aisle={output.grouped_by_aisle}
              onBack={() => setStep("review")}
              onReset={handleReset}
            />
          </>
        )}
      </div>

      {/* Footer */}
      <p className="text-center text-xs text-stone-400 mt-6">
        Works with most recipe sites — best results on sites with structured
        recipe data.
      </p>
    </main>
  );
}
