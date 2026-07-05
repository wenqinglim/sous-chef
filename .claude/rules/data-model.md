---
paths:
  - "src/types/**/*.ts"
  - "src/lib/db/**/*.ts"
  - "src/lib/derive.ts"
  - "src/lib/pipeline/**/*.ts"
  - "src/lib/extractors/**/*.ts"
  - "src/lib/normalizers/**/*.ts"
  - "src/lib/recipe/**/*.ts"
  - "prisma/schema.prisma"
---

# Data model

```typescript
CanonicalIngredient {
  id: string
  name: string
  aliases: string[]
  aisle: string          // "produce" | "meat" | "dairy" | "asian_grocery" | "pantry" | "condiments" | ...
  default_purchase_unit: string
  default_purchase_size: number
  is_staple: boolean
  canonical_unit: string
  conversion_factors: Record<string, number>
}

Recipe {
  id: string
  url: string
  title: string
  base_servings: number
  parsed_at: string      // ISO date; recipes cached for 7 days
  cuisine_source: "asian" | "western" | "unknown"
  ingredients: RecipeIngredient[]
  instructions: InstructionStep[]  // numbered cooking steps; [] when extraction found none
  notes?: string | null   // freeform user notes (customization); absent on fresh extracts
  edited?: boolean         // true once a user saved an edit; guards against re-extract clobber
}

RecipeIngredient {
  recipe_id: string
  raw_text: string       // preserve original for manual-edit step
  quantity: number | null
  unit: string | null
  name: string           // parsed name (no quantity/prep notes)
  canonical_id: string | null
  section?: string | null // group label, e.g. "For the sauce"; null/absent = ungrouped
}

InstructionStep {
  text: string            // a single cooking step
  section?: string | null // group label, e.g. "Make the sauce"; null/absent = ungrouped
}

MealPlan {
  id: string
  name: null             // null in MVP
  recipes: Array<{ recipe_id: string; target_servings: number }>
}

PurchaseItem {
  canonical_id: string
  display_name: string
  recipe_quantity: number
  recipe_unit: string
  purchase_unit: string
  purchase_quantity: number
  leftover_quantity: number
  aisle: string
  is_staple: boolean
}
```

`section` is additive on the JSONB columns (no migration); legacy `string[]` instructions are coerced to `InstructionStep[]` at read via `normalizeInstructions`.
