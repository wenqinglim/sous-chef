"use client";

/**
 * Recipe detail page — read a single saved recipe (ingredients, steps, notes)
 * and act on it (open original, add to grocery list). Editing is layered on in
 * a later change via a "Customize" mode.
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { Recipe } from "@/types";
import RecipeView from "@/components/RecipeView";

export default function RecipeDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/recipes/${id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load recipe");
        if (!cancelled) setRecipe(data.recipe);
      } catch {
        if (!cancelled) setError("Couldn't load that recipe.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-8">
        <Link href="/" className="text-sm text-stone-500 hover:text-stone-700">
          ← Back to recipes
        </Link>
        <p className="mt-4 text-sm text-red-600">⚠️ {error}</p>
      </main>
    );
  }

  if (!recipe) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-8">
        <p className="text-sm text-stone-400">Loading recipe…</p>
      </main>
    );
  }

  return <RecipeView recipe={recipe} />;
}
