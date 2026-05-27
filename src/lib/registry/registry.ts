/**
 * Canonical ingredient registry.
 *
 * Loads src/data/ingredients.json and builds three indexes for fast lookup:
 *   byId    — Map<canonical_id, CanonicalIngredient>
 *   byAlias — Map<normalised_alias, canonical_id>
 *   byName  — Map<normalised_name, canonical_id>
 *
 * "Normalised" means: lowercased, leading/trailing whitespace stripped,
 * consecutive whitespace collapsed, punctuation stripped.
 */

import type { CanonicalIngredient } from "@/types";
import seedData from "@/data/ingredients.json";

// ─── Index types ──────────────────────────────────────────────────────────────

interface Registry {
  byId: Map<string, CanonicalIngredient>;
  byAlias: Map<string, string>; // normalised alias → canonical_id
  byName: Map<string, string>; // normalised name → canonical_id
  all: CanonicalIngredient[];
}

// ─── Normalise a string for index lookup ─────────────────────────────────────

export function normaliseForLookup(s: string): string {
  const hasNonAscii = /[^\x00-\x7F]/.test(s);
  if (hasNonAscii) {
    // For non-ASCII strings (Chinese, Thai, Korean …): just trim + collapse whitespace.
    // Don't strip characters — "大蒜" and "ขิง" must remain distinct.
    return s.trim().replace(/\s+/g, " ");
  }
  // For ASCII: lowercase, strip punctuation, collapse whitespace
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Build the registry (runs once at module load) ────────────────────────────

function buildRegistry(): Registry {
  const byId = new Map<string, CanonicalIngredient>();
  const byAlias = new Map<string, string>();
  const byName = new Map<string, string>();
  const all: CanonicalIngredient[] = [];

  for (const raw of seedData.ingredients) {
    const ingredient = raw as CanonicalIngredient;
    all.push(ingredient);

    if (byId.has(ingredient.id)) {
      console.warn(`[registry] Duplicate ID: ${ingredient.id}`);
    }
    byId.set(ingredient.id, ingredient);

    // Index by normalised name
    const normName = normaliseForLookup(ingredient.name);
    if (!byName.has(normName)) {
      byName.set(normName, ingredient.id);
    }

    // Index all aliases
    for (const alias of ingredient.aliases) {
      const normAlias = normaliseForLookup(alias);
      if (byAlias.has(normAlias) && byAlias.get(normAlias) !== ingredient.id) {
        // Alias collision — warn but keep the first registration
        console.warn(
          `[registry] Alias collision: "${alias}" (${normAlias}) ` +
            `registered to both "${byAlias.get(normAlias)}" and "${ingredient.id}"`
        );
      } else {
        byAlias.set(normAlias, ingredient.id);
      }
    }
  }

  return { byId, byAlias, byName, all };
}

// Singleton — evaluated once when the module is first imported
const registry = buildRegistry();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Look up an ingredient by canonical ID.
 * Returns null if not found.
 */
export function findById(id: string): CanonicalIngredient | null {
  return registry.byId.get(id) ?? null;
}

/**
 * Look up an ingredient by any of its aliases or its name.
 * The lookup is case-insensitive and strips punctuation.
 * Returns null if no match.
 */
export function findByAlias(rawName: string): CanonicalIngredient | null {
  const norm = normaliseForLookup(rawName);

  // Try exact alias match
  const aliasId = registry.byAlias.get(norm);
  if (aliasId) return registry.byId.get(aliasId) ?? null;

  // Try exact name match
  const nameId = registry.byName.get(norm);
  if (nameId) return registry.byId.get(nameId) ?? null;

  return null;
}

/**
 * Return all canonical ingredients (e.g. for LLM batch prompts).
 */
export function getAllIngredients(): CanonicalIngredient[] {
  return registry.all;
}

/**
 * Return a summary list of { id, name, aliases } for use in LLM prompts.
 */
export function getRegistrySummary(): Array<{
  id: string;
  name: string;
  aliases: string[];
}> {
  return registry.all.map(({ id, name, aliases }) => ({ id, name, aliases }));
}

/**
 * Check if any duplicate alias collisions exist in the registry.
 * Used in tests.
 */
export function detectAliasCollisions(): Array<{
  alias: string;
  ids: string[];
}> {
  const aliasToIds = new Map<string, string[]>();

  for (const ingredient of registry.all) {
    for (const alias of ingredient.aliases) {
      const norm = normaliseForLookup(alias);
      const existing = aliasToIds.get(norm) ?? [];
      if (!existing.includes(ingredient.id)) {
        aliasToIds.set(norm, [...existing, ingredient.id]);
      }
    }
    const normName = normaliseForLookup(ingredient.name);
    const existing = aliasToIds.get(normName) ?? [];
    if (!existing.includes(ingredient.id)) {
      aliasToIds.set(normName, [...existing, ingredient.id]);
    }
  }

  return Array.from(aliasToIds.entries())
    .filter(([, ids]) => ids.length > 1)
    .map(([alias, ids]) => ({ alias, ids }));
}
