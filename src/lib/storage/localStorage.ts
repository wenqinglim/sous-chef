/**
 * localStorage helpers for the sous-chef MVP.
 *
 * Persists MealPlan + cached Recipes across browser sessions.
 * SSR-safe: all access is guarded by typeof window !== 'undefined'.
 *
 * Storage keys:
 *   sous-chef:meal-plan    MealPlan JSON
 *   sous-chef:recipes      Record<recipe_id, Recipe> JSON
 *
 * Note: the LLM normalization cache is in-memory only (see llm-fallback.ts).
 *
 * Versioning:
 *   Each stored value includes a schemaVersion field.
 *   If the version doesn't match CURRENT_VERSION, the value is discarded.
 *
 * Recipe TTL:
 *   Recipes are cached for RECIPE_TTL_MS (7 days).
 *   Stale recipes are removed from the cache on load.
 */

import type { MealPlan, Recipe } from "@/types";
import { v4 as uuidv4 } from "uuid";

// ─── Constants ────────────────────────────────────────────────────────────────

const KEYS = {
  MEAL_PLAN: "sous-chef:meal-plan",
  RECIPES: "sous-chef:recipes",
} as const;

const CURRENT_VERSION = "1";
const RECIPE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── Safe localStorage access ─────────────────────────────────────────────────

function safeGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage full or blocked — silently ignore
  }
}

function safeRemove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

// ─── Versioned wrapper ────────────────────────────────────────────────────────

interface Versioned<T> {
  schemaVersion: string;
  data: T;
}

function readVersioned<T>(key: string): T | null {
  const raw = safeGet(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Versioned<T>;
    if (parsed.schemaVersion !== CURRENT_VERSION) {
      safeRemove(key);
      return null;
    }
    return parsed.data;
  } catch {
    safeRemove(key);
    return null;
  }
}

function writeVersioned<T>(key: string, data: T): void {
  const versioned: Versioned<T> = { schemaVersion: CURRENT_VERSION, data };
  safeSet(key, JSON.stringify(versioned));
}

// ─── MealPlan ─────────────────────────────────────────────────────────────────

export function loadMealPlan(): MealPlan {
  const stored = readVersioned<MealPlan>(KEYS.MEAL_PLAN);
  if (stored) return stored;

  // Return a fresh empty plan
  return { id: uuidv4(), name: null, recipes: [] };
}

export function saveMealPlan(plan: MealPlan): void {
  writeVersioned(KEYS.MEAL_PLAN, plan);
}

// ─── Recipe cache ─────────────────────────────────────────────────────────────

export function loadRecipes(): Map<string, Recipe> {
  const stored = readVersioned<Record<string, Recipe>>(KEYS.RECIPES);
  if (!stored) return new Map();

  const now = Date.now();
  const map = new Map<string, Recipe>();

  for (const [id, recipe] of Object.entries(stored)) {
    // Check TTL
    const parsedAt = new Date(recipe.parsed_at).getTime();
    if (now - parsedAt > RECIPE_TTL_MS) {
      // Stale — skip (will be pruned on next save)
      continue;
    }
    map.set(id, recipe);
  }

  return map;
}

export function saveRecipes(recipes: Map<string, Recipe>): void {
  const obj: Record<string, Recipe> = {};
  for (const [id, recipe] of Array.from(recipes.entries())) {
    obj[id] = recipe;
  }
  writeVersioned(KEYS.RECIPES, obj);
}

export function addRecipe(recipe: Recipe, existing: Map<string, Recipe>): Map<string, Recipe> {
  const updated = new Map(existing);
  updated.set(recipe.id, recipe);
  saveRecipes(updated);
  return updated;
}

export function removeRecipe(recipeId: string, existing: Map<string, Recipe>): Map<string, Recipe> {
  const updated = new Map(existing);
  updated.delete(recipeId);
  saveRecipes(updated);
  return updated;
}

// ─── Utility: clear all sous-chef data ───────────────────────────────────────

export function clearAllStorage(): void {
  safeRemove(KEYS.MEAL_PLAN);
  safeRemove(KEYS.RECIPES);
}
