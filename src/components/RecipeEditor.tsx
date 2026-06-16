"use client";

/**
 * RecipeEditor — customize a saved recipe.
 *
 * Edits title, base servings, ingredients (raw text), method steps, and notes.
 * On save, each ingredient's raw_text is re-parsed via parseIngredient() so the
 * stored quantity/unit/name stay coherent, and canonical_id is reset to null so
 * the grocery pipeline re-normalizes. Persists via PUT /api/recipes/[id], which
 * flags the recipe `edited` (protecting it from re-extract clobber).
 */

import { useState } from "react";
import type { Recipe, RecipeIngredient } from "@/types";
import { parseIngredient } from "@/lib/units/parser";
import { rescaleIngredientLine } from "@/lib/units/rescale";

interface Props {
  recipe: Recipe;
  onSaved: (updated: Recipe) => void;
  onCancel: () => void;
}

/**
 * A single editable line carrying a stable id, so React keys survive reordering
 * and deletion (index keys would make focus/caret jump between rows).
 */
interface Line {
  id: string;
  text: string;
}

let lineSeq = 0;
const newLine = (text: string): Line => ({ id: `line-${lineSeq++}`, text });

function move<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export default function RecipeEditor({ recipe, onSaved, onCancel }: Props) {
  const [title, setTitle] = useState(recipe.title);
  const [baseServings, setBaseServings] = useState(recipe.base_servings);
  const [ingredients, setIngredients] = useState<Line[]>(() =>
    recipe.ingredients.map((ing) => newLine(ing.raw_text))
  );
  const [steps, setSteps] = useState<Line[]>(() =>
    (recipe.instructions ?? []).map((s) => newLine(s))
  );
  const [notes, setNotes] = useState(recipe.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Servings the ingredient lines are currently expressed in. Starts equal to
  // baseServings; the user can apply a one-click rescale to bring them back
  // into sync after bumping baseServings.
  const [ingredientServings, setIngredientServings] = useState(
    recipe.base_servings
  );
  const ingredientsOutOfSync = baseServings !== ingredientServings;

  function applyRescale() {
    if (!ingredientsOutOfSync || ingredientServings <= 0) return;
    const factor = baseServings / ingredientServings;
    setIngredients((prev) =>
      prev.map((l) => ({ ...l, text: rescaleIngredientLine(l.text, factor) }))
    );
    setIngredientServings(baseServings);
  }

  async function handleSave() {
    if (!title.trim()) {
      setError("Title can't be empty.");
      return;
    }
    setSaving(true);
    setError(null);

    // Apply any pending rescale before serializing so we can never persist
    // `base_servings` that disagrees with the ingredient text. The user-facing
    // banner makes the rescale explicit, but Save is the source of truth.
    const factor =
      ingredientsOutOfSync && ingredientServings > 0
        ? baseServings / ingredientServings
        : 1;
    const builtIngredients: RecipeIngredient[] = ingredients
      .map((l) => l.text.trim())
      .filter(Boolean)
      .map((text) => (factor === 1 ? text : rescaleIngredientLine(text, factor)))
      .map((raw_text) => {
        const p = parseIngredient(raw_text);
        return {
          recipe_id: recipe.id,
          raw_text,
          quantity: p.quantity,
          unit: p.unit,
          name: p.name,
          canonical_id: null,
        };
      });

    const body = {
      title: title.trim(),
      base_servings: Math.max(1, baseServings),
      ingredients: builtIngredients,
      instructions: steps.map((l) => l.text.trim()).filter(Boolean),
      notes: notes.trim() ? notes.trim() : null,
    };

    try {
      const res = await fetch(`/api/recipes/${recipe.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to save changes");
        return;
      }
      onSaved(data.recipe as Recipe);
    } catch {
      setError("Network error — please try again");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <button
        onClick={onCancel}
        className="text-sm text-stone-500 hover:text-stone-700"
      >
        ← Cancel
      </button>

      <div className="mt-4 bg-white rounded-xl border border-stone-200 shadow-sm p-6 space-y-6">
        {/* Title + servings */}
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-60">
            <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
          <div className="w-32">
            <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1">
              Base servings
            </label>
            <input
              type="number"
              min={1}
              max={100}
              value={baseServings}
              onChange={(e) => setBaseServings(parseInt(e.target.value) || 1)}
              className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
        </div>
        {ingredientsOutOfSync ? (
          <div className="-mt-3 flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <span>
              Ingredients are still written for {ingredientServings} servings.
              They&apos;ll auto-rescale to {baseServings} on Save — preview now?
            </span>
            <button
              type="button"
              onClick={applyRescale}
              className="shrink-0 px-2 py-1 text-xs font-medium rounded bg-amber-600 text-white hover:bg-amber-700"
            >
              Rescale now
            </button>
          </div>
        ) : (
          <p className="-mt-3 text-xs text-stone-400">
            Ingredient amounts below are for this many servings. Change this
            number and they&apos;ll auto-rescale on Save.
          </p>
        )}

        {/* Notes */}
        <div>
          <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1">
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Personal tweaks, substitutions, reminders…"
            className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>

        {/* Ingredients */}
        <ListEditor
          label="Ingredients"
          items={ingredients}
          onChange={setIngredients}
          placeholder="e.g. 2 cloves garlic, minced"
          addLabel="+ Add ingredient"
        />

        {/* Steps */}
        <ListEditor
          label="Method"
          items={steps}
          onChange={setSteps}
          placeholder="Describe a step…"
          addLabel="+ Add step"
          numbered
          multiline
        />

        {error && <p className="text-sm text-red-600">⚠️ {error}</p>}

        <div className="flex gap-2 pt-2 border-t border-stone-100">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-2 border border-stone-300 text-stone-700 text-sm font-medium rounded-lg hover:bg-stone-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </main>
  );
}

// ─── List editor (shared by ingredients + steps) ─────────────────────────────

interface ListEditorProps {
  label: string;
  items: Line[];
  onChange: (items: Line[]) => void;
  placeholder: string;
  addLabel: string;
  numbered?: boolean;
  multiline?: boolean;
}

function ListEditor({
  label,
  items,
  onChange,
  placeholder,
  addLabel,
  numbered,
  multiline,
}: ListEditorProps) {
  function update(i: number, value: string) {
    onChange(items.map((it, idx) => (idx === i ? { ...it, text: value } : it)));
  }
  function remove(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }
  function reorder(from: number, to: number) {
    onChange(move(items, from, to));
  }

  return (
    <div>
      <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">
        {label}
      </label>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={item.id} className="flex items-start gap-2">
            {numbered && (
              <span className="mt-2 text-xs text-stone-400 w-4 text-right">
                {i + 1}.
              </span>
            )}
            {multiline ? (
              <textarea
                value={item.text}
                onChange={(e) => update(i, e.target.value)}
                placeholder={placeholder}
                rows={2}
                className="flex-1 border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            ) : (
              <input
                type="text"
                value={item.text}
                onChange={(e) => update(i, e.target.value)}
                placeholder={placeholder}
                className="flex-1 border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            )}
            <div className="flex flex-col">
              <button
                onClick={() => reorder(i, i - 1)}
                disabled={i === 0}
                className="text-stone-400 hover:text-stone-700 disabled:opacity-30 text-xs leading-none px-1"
                aria-label="Move up"
              >
                ▲
              </button>
              <button
                onClick={() => reorder(i, i + 1)}
                disabled={i === items.length - 1}
                className="text-stone-400 hover:text-stone-700 disabled:opacity-30 text-xs leading-none px-1"
                aria-label="Move down"
              >
                ▼
              </button>
            </div>
            <button
              onClick={() => remove(i)}
              className="mt-1.5 text-stone-400 hover:text-red-500 text-lg leading-none"
              aria-label={`Remove ${label} item`}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={() => onChange([...items, newLine("")])}
        className="mt-2 text-sm font-medium text-amber-700 hover:text-amber-800"
      >
        {addLabel}
      </button>
    </div>
  );
}
