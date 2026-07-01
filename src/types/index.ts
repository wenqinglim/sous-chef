// ─── Aisle taxonomy ──────────────────────────────────────────────────────────

export type Aisle =
  | "produce"
  | "meat"
  | "seafood"
  | "dairy"
  | "deli"
  | "bakery"
  | "frozen"
  | "asian_grocery"
  | "pantry"
  | "condiments"
  | "beverages"
  | "other";

// ─── Canonical Ingredient Registry ───────────────────────────────────────────

export interface CanonicalIngredient {
  id: string;
  name: string;
  aliases: string[];
  aisle: Aisle;
  /** e.g. "can", "lb", "bunch", "bottle", "head" */
  default_purchase_unit: string;
  /** Size of the default purchase unit in canonical_unit terms */
  default_purchase_size: number;
  is_staple: boolean;
  /** Base unit for quantity math: "ml" | "g" | "each" | "bunch" | "can" | ... */
  canonical_unit: string;
  /** Maps other unit names → how many canonical_units they equal.
   *  e.g. { "cup": 236.588, "tbsp": 14.787 } for a liquid measured in ml */
  conversion_factors: Record<string, number>;
  /** g per ml, for cross-family (volume↔weight) conversion of liquids */
  density_g_per_ml?: number;
}

// ─── Recipe (output of the Extraction layer) ─────────────────────────────────

export type CuisineSource = "asian" | "western" | "unknown";

export interface RecipeIngredient {
  recipe_id: string;
  /** Full original text, preserved for the manual-edit confirmation step */
  raw_text: string;
  /** Parsed quantity (null = "to taste" / "as needed") */
  quantity: number | null;
  /** Parsed unit string, lowercased (null when no unit appears in the text, e.g. "2 eggs") */
  unit: string | null;
  /** Ingredient name after stripping quantity, unit, and prep notes */
  name: string;
  /** Resolved after normalization; null if unresolvable */
  canonical_id: string | null;
  /** Section/group label, e.g. "For the sauce"; null/absent = ungrouped */
  section?: string | null;
}

/** A single cooking step, optionally tagged with its section/group label. */
export interface InstructionStep {
  text: string;
  /** Section/group label, e.g. "For the sauce"; null/absent = ungrouped */
  section?: string | null;
}

export interface Recipe {
  id: string;
  url: string;
  title: string;
  base_servings: number;
  /** ISO date string; used for 7-day cache TTL */
  parsed_at: string;
  /** Inferred from URL domain; drives soy-sauce disambiguation */
  cuisine_source: CuisineSource;
  ingredients: RecipeIngredient[];
  /** Numbered cooking steps; empty array when extraction found none */
  instructions: InstructionStep[];
  /** Freeform user notes; optional (absent on freshly extracted / cached recipes) */
  notes?: string | null;
  /** True once a user has saved a manual edit; guards against re-extract clobber */
  edited?: boolean;
}

// ─── Meal Plan ────────────────────────────────────────────────────────────────

export interface MealPlanEntry {
  recipe_id: string;
  target_servings: number;
}

export interface MealPlan {
  id: string;
  /** null in MVP; named in "saved meal plans" post-MVP */
  name: null | string;
  recipes: MealPlanEntry[];
}

// ─── Normalization layer ──────────────────────────────────────────────────────

export interface NormalizedIngredient {
  recipe_id: string;
  canonical_id: string;
  /** Quantity already scaled by target_servings / base_servings */
  quantity: number;
  /** The canonical base unit for this ingredient (ml | g | each | ...) */
  canonical_unit: string;
  raw_text: string;
  /** How this was resolved */
  resolution_method: "lookup" | "llm" | "unknown";
}

/** Ingredient that could not be mapped to a canonical ID */
export interface UnresolvableIngredient {
  recipe_id: string;
  raw_text: string;
  name: string;
  quantity: number | null;
  unit: string | null;
}

// ─── Aggregation layer ────────────────────────────────────────────────────────

export interface AggregatedIngredient {
  canonical_id: string;
  /** Total quantity in the ingredient's canonical_unit */
  total_quantity: number;
  canonical_unit: string;
  /** Recipe IDs that contributed to this total */
  contributing_recipe_ids: string[];
}

// ─── Purchase Planning layer ──────────────────────────────────────────────────

export interface PurchaseItem {
  canonical_id: string;
  display_name: string;
  /** Raw total needed by all recipes (in recipe/canonical units) */
  recipe_quantity: number;
  recipe_unit: string;
  /** e.g. "can", "bunch", "lb", "bottle" */
  purchase_unit: string;
  /** Rounded up to nearest whole supermarket unit */
  purchase_quantity: number;
  /** (purchase_quantity × purchase_size) − recipe_quantity; for post-MVP pantry/leftover features */
  leftover_quantity: number;
  aisle: Aisle;
  is_staple: boolean;
}

// ─── Internal parser types ────────────────────────────────────────────────────

export interface ParsedQuantity {
  quantity: number | null;
  unit: string | null;
  /** Ingredient name after stripping quantity + unit + prep notes */
  name: string;
}

// ─── Normalization result (internal) ─────────────────────────────────────────

export interface NormalizationResult {
  canonical_id: string | null;
  canonical: CanonicalIngredient | null;
  method: "lookup" | "llm" | "unknown";
  confidence: number;
}

// ─── API response shapes ──────────────────────────────────────────────────────

export interface GroceryListResponse {
  items: PurchaseItem[];
  unresolvable: UnresolvableIngredient[];
  grouped_by_aisle: Partial<Record<Aisle, PurchaseItem[]>>;
}
