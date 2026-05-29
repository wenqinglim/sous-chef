# Sous-Chef — Developer Guide

## What This App Does

Accepts recipe URLs + desired serving sizes, extracts ingredients, scales + aggregates quantities across recipes, and outputs a copyable grocery checklist formatted for Google Keep (line breaks become checkboxes).

## Tech Stack

- **Framework**: Next.js 15 (App Router, TypeScript)
- **Styling**: Tailwind CSS
- **LLM**: Claude API (`@anthropic-ai/sdk`) — used as fallback only; primary extraction uses schema.org JSON-LD
- **State**: localStorage (no database in MVP)
- **Testing**: Jest + ts-jest
- **HTML parsing**: cheerio (server-side only)

## Environment Variables

Copy `.env.local.example` to `.env.local` and fill in:

```
ANTHROPIC_API_KEY=sk-ant-...
```

## Running Locally

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # run all tests
npm run build    # production build
```

## Architecture — Five-Layer Pipeline

Every layer has a stable output shape. Layers never talk backwards.

```
URL
 │
 ▼
[1] Extraction        URL → Recipe
      Primary: schema.org JSON-LD (cheerio)
      Fallback: Claude API (raw HTML → structured JSON)
 │
 ▼
[2] Normalization     raw ingredient text → canonical ingredient
      Primary: alias lookup in ingredients registry (src/lib/registry/)
      Fallback: Claude API batch call
      Handles: metric/imperial conversion, parenthetical stripping,
               soy sauce disambiguation by cuisine source
 │
 ▼
[3] Aggregation       sum quantities by canonical_id across all recipes
      Pure math. Converts everything to base units (ml, g, each) before summing.
 │
 ▼
[4] Purchase Planning convert aggregated quantity → supermarket purchase units
      Math.ceil to nearest whole purchase unit.
      Emits: purchase_quantity, leftover_quantity, aisle, is_staple
      (all fields emitted even if MVP UI hides some)
 │
 ▼
[5] Presentation      flat checklist, copy button
```

## Key Design Decisions

### Grocery list is a pure derivation — never persisted
`list = derive(MealPlan, cachedRecipes)`. Edit inputs → recompute output. No sync bugs.

### All PurchaseItem fields computed from day one
`leftover_quantity`, `aisle`, `is_staple` are computed and returned even though the MVP UI doesn't display them. Post-MVP features (aisle grouping, pantry mode, leftover tracking) just read fields that already exist.

### MealPlan lives in localStorage in MVP
Shape: `{ id, name: null, recipes: [{ recipe_id, target_servings }] }`. "Saved meal plans" post-MVP = add `name` + server persistence. No structural change.

### Manual edit step is part of MVP
After parsing, show the user extracted ingredients for confirmation before processing. Parsing fails more often than you'd think.

## Data Model

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
}

RecipeIngredient {
  recipe_id: string
  raw_text: string       // preserve original for manual-edit step
  quantity: number | null
  unit: string | null
  name: string           // parsed name (no quantity/prep notes)
  canonical_id: string | null
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

## Primary Recipe Sources

All four sites have clean schema.org JSON-LD markup — Claude fallback should rarely fire.

| Site | Domain | Unit System | Notes |
|------|--------|-------------|-------|
| RecipeTin Eats | recipetineats.com | Metric-first | Australian; clean @graph LD+JSON |
| The Woks of Life | thewoksoflife.com | Imperial | Chinese family cooking; cuisine_source=asian |
| Hot Thai Kitchen | hot-thai-kitchen.com | Metric | Thai; sometimes Thai script in ingredient parens |
| Made With Lau | madewithlau.com | Mixed | Cantonese; sometimes Chinese characters in parens |

## Canonical Ingredient Registry

`src/data/ingredients.json` — ~300 entries. Schema version: `1.0.0`.

Two distinct IDs for soy sauce disambiguation:
- `soy_sauce_light` — Chinese-cuisine sources (woksoflife.com, madewithlau.com, hot-thai-kitchen.com)
- `soy_sauce_all_purpose` — Western sources (recipetineats.com etc.)

Heuristic: unqualified "soy sauce" → `soy_sauce_light` if `cuisine_source === 'asian'`.

## API Routes

| Route | Method | Body | Response | Note |
|-------|--------|------|----------|------|
| `/api/extract` | POST | `{ url }` | `Recipe` | Server-side fetch; avoids CORS |
| `/api/normalize` | POST | `{ ingredients[], cuisine_source }` | `NormalizedIngredient[]` | Calls Claude in batch for unknowns |
| `/api/grocery-list` | POST | `{ recipes: [{ recipe, target_servings }] }` | `{ items, grouped_by_aisle }` | Full pipeline |

## Unit Conversions (base units: ml, g, each)

| Unit | → ml | | Unit | → g |
|------|------|-|------|-----|
| tsp | 4.929 | | oz | 28.3495 |
| tbsp | 14.787 | | lb | 453.592 |
| fl oz | 29.574 | | kg | 1000 |
| cup | 236.588 | | g | 1 |
| pint | 473.176 | | | |
| L | 1000 | | | |

Special: stick of butter = 113g; 1 inch ginger ≈ 6g.

## Aisle Taxonomy

`produce` | `meat` | `seafood` | `dairy` | `deli` | `bakery` | `frozen` | `asian_grocery` | `pantry` | `condiments` | `beverages` | `other`

`asian_grocery` is intentionally separate from `pantry` — many shopping trips genuinely split across two stores.

## Implementation Status

- [x] Task 1: Project scaffold + CLAUDE.md
- [x] Task 2: Type definitions
- [x] Task 3: Unit conversion + parser
- [x] Task 4: Canonical ingredient registry
- [ ] Task 5: Text cleaning + normalization lookup
- [ ] Task 6: Schema.org extractor + test fixtures
- [ ] Task 7: LLM normalization fallback
- [ ] Task 8: Pipeline (extract + normalize + aggregate + purchase)
- [ ] Task 9: API routes
- [ ] Task 10: localStorage helpers
- [ ] Task 11: UI components + main page
- [ ] Task 12: Integration tests + final CLAUDE.md update
