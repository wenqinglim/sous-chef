# Sous-Chef — Developer Guide

## What This App Does

A **recipe library** is the primary surface: the home page (`/`) lists your saved recipes; open one (`/recipes/[id]`) to read its ingredients, steps, and notes, follow a link back to the original source, and customize it. Recipes are imported from a URL (schema.org JSON-LD, Claude fallback) and auto-saved to a shared library (Postgres).

Turning recipes into a **grocery list** is a secondary feature on its own route (`/grocery-list`): pick recipes + serving sizes, scale + aggregate quantities across them, and copy a checklist formatted for Google Keep (line breaks become checkboxes).

### Pages / Routes (UI)

| Route | Purpose |
|-------|---------|
| `/` | Recipe library — grid of saved recipes (`RecipeLibraryGrid`) + URL importer (`AddRecipeForm`) |
| `/recipes/[id]` | Single-recipe detail (`RecipeView`) + customize editor (`RecipeEditor`); link to original URL; "Add to grocery list" |
| `/grocery-list` | The build-a-grocery-list wizard (URL → review → list); the saved-recipe picker also lives here |

Shared chrome (`SiteHeader`) lives in `src/app/layout.tsx`.

## Tech Stack

- **Framework**: Next.js 15 (App Router, TypeScript)
- **Styling**: Tailwind CSS
- **LLM**: Claude API (`@anthropic-ai/sdk`) — used as fallback only; primary extraction uses schema.org JSON-LD
- **Database**: Postgres (Neon free tier via Vercel Marketplace) + Prisma 6 — shared recipe library; single-user for now (nullable `user_id` reserved for multi-user)
- **State**: localStorage for draft meal-plan state; the DB is the durable recipe library
- **Testing**: Jest + ts-jest
- **HTML parsing**: cheerio (server-side only)

## Environment Variables

Copy `.env.local.example` to `.env.local` and fill in:

```
ANTHROPIC_API_KEY=sk-ant-...
DATABASE_URL=postgresql://...   # Neon connection string; injected by the Vercel↔Neon integration in prod
GROQ_API_KEY=gsk_...            # Groq Whisper — Instagram reel audio transcription
IG_SESSIONID=...                # Instagram session cookie — required to import reels (see Instagram reels below)
```

## Running Locally

```bash
npm install
npm run db:deploy  # apply Prisma migrations (once per database)
npm run dev        # http://localhost:3000
npm test           # run all tests (345 passing; no DB needed — Prisma is mocked)
npm run build      # production build: prisma generate → migrate deploy → next build
```

> `build` runs `prisma migrate deploy` so every deploy (Vercel) applies pending
> migrations to the target database before serving — this is what keeps prod's
> schema in sync with the code. A consequence: `npm run build` needs a reachable
> `DATABASE_URL`. For a build-only check without a DB, run
> `npm run db:deploy` separately (or `next build` directly) and rely on `npm test`.

## Test Coverage

345 tests across 9 suites:
- `tests/units.test.ts` — unit conversions + ingredient text parser, incl. mixed/unicode ranges
- `tests/normalization.test.ts` — registry lookup, alias matching, soy sauce disambiguation, messy-name robustness
- `tests/extraction.test.ts` — schema.org extraction for all 4 target sites + `parseInstructions` for every JSON-LD instruction shape
- `tests/instagram.test.ts` — Instagram URL detection, caption extraction (JSON-LD + og:description), recipe heuristic gate, and orchestration (LLM mocked)
- `tests/llm-fallback.test.ts` — `extractJsonText` unwraps markdown-fenced / prose-wrapped LLM JSON responses
- `tests/rescale.test.ts` — ingredient quantity rescaling by servings
- `tests/pipeline.test.ts` — aggregate, purchase planning, full derive(), purchase-unit + slice→weight + metric-output regressions
- `tests/safe-fetch.test.ts` — SSRF protections
- `tests/recipes-repo.test.ts` — recipe repository mappers + mocked-Prisma flows (upsert id retention, URL dedupe, summaries, `updateRecipe` edits, edited-recipe re-extract guard)

## Verification Checklist (manual smoke test)

0. **Library home**: on `/`, paste a RecipeTin Eats URL into "Add a recipe" → lands on `/recipes/[id]`; the recipe also appears as a card on `/`
1. **Detail view**: open a saved recipe → title, ingredients, and numbered steps render; "View original recipe ↗" opens `recipe.url` in a new tab
1a. **Customize**: click "✏️ Customize" → edit an ingredient, add/remove a step, add a note → Save → reload the page: edits persist and the card/detail shows a "Customized" badge. Re-importing the same URL no longer overwrites the edits
2. **Single recipe (grocery)**: from a recipe, "Add to grocery list" → on `/grocery-list`, set 4 servings → ingredients render in review step
3. **Scaling**: Change servings to 6 → confirm quantities reflect target_servings, not base_servings
4. **Multi-recipe**: Add a Woks of Life recipe alongside RecipeTin Eats → verify shared ingredients (garlic) aggregate into one line item
5. **Soy sauce test**: Woks of Life recipe → soy sauce should show as "Soy Sauce (Light)" in the list
6. **Copy to Google Keep**: click copy → paste into Google Keep note → each line becomes a checkbox
7. **Thai script**: Hot Thai Kitchen recipe → Thai characters in parentheses stripped from ingredient names
8. **LocalStorage restore**: on `/grocery-list`, close and reopen the browser → previously loaded recipes should still be there
9. **Saved library picker**: on `/grocery-list`, pick a recipe from "Or pick from your saved recipes" (no URL) → grocery list generates identically
10. **DB down**: with `DATABASE_URL` unset, the home grid degrades quietly and URL extraction still works (response has `saved: false`)

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
  instructions: string[]  // numbered cooking steps; [] when extraction found none
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

### Instagram reels

Instagram pages have no recipe JSON-LD, so `/api/extract` detects Instagram URLs
(`isInstagramUrl`) and branches to `src/lib/extractors/instagram.ts` instead of the
schema.org → body-text path. The assumption is that the **reel caption contains the full
recipe**. Flow: `extractInstagramCaption(html)` (JSON-LD caption → `og:description` fallback,
with the "N likes, M comments - user on date:" preamble stripped) → `looksLikeRecipe(caption)`
heuristic gate (recipe keyword OR ≥3 quantity+unit matches; rejects non-recipe captions before
spending an LLM call) → `extractWithLlm(caption, url)`. `cuisine_source` is `unknown`.

**Audio fallback.** Many creators narrate the method instead of writing it. When the caption is
absent/incomplete, `extractFromInstagramWithAudio` finds the reel's video URL, downloads it
(`binaryFetch`, 24 MB cap), transcribes it with Groq Whisper (`transcribeWithWhisper`,
`whisper-large-v3`), and runs the transcript through the same LLM extractor. It degrades
gracefully: if audio fails but the caption gave a partial recipe, the partial is saved rather
than erroring.

**Authentication (`IG_SESSIONID`) is now required.** As of 2025 Instagram login-walls *both* the
caption and the video for logged-out/datacenter requests — the `facebookexternalhit` crawler UA
gets a "Welcome back to Instagram. Sign in…" shell, and the embed page (`/reel/X/embed/captioned/`)
is a JS shell whose initial HTML contains no video URL (only `static.cdninstagram.com/rsrc.php`
asset bundles). So the route now re-fetches the reel **with a session cookie**:
`instagramAuthHeaders()` builds `Cookie: sessionid=…` + `X-IG-App-ID: 936619743392459` from the
`IG_SESSIONID` env var. With it, `extractFromInstagramWithAudio` (1) re-fetches the reel page
authenticated and uses that HTML for caption + video, and (2) queries the web JSON API
(`/api/v1/media/{shortcode}/info/`, then `?__a=1&__d=dis`) and pulls the CDN URL out of
`video_versions[].url` via `extractVideoUrlFromApiJson`. Video-URL discovery order:
authenticated page HTML → authenticated JSON API → public embed page (dual-UA) →
anonymous `?__a=1` (only when no cookie).

Every step logs a `[IG] …` line (`console.error` → Vercel logs) and emits a human-readable
`onStatus` message (→ SSE → UI), so a failed import shows exactly which stage broke.

> **Operational note:** `IG_SESSIONID` is a personal session cookie (instagram.com → DevTools →
> Application → Cookies → `sessionid`). It expires every few months; when reel imports start
> failing with "the IG_SESSIONID cookie may have expired", re-paste a fresh value. Without the
> cookie set, reel imports fail with a clear error pointing the user to set it (never a bad recipe).

## Canonical Ingredient Registry

`src/data/ingredients.json` — ~300 entries. Schema version: `1.0.0`.

Two distinct IDs for soy sauce disambiguation:
- `soy_sauce_light` — Chinese-cuisine sources (woksoflife.com, madewithlau.com, hot-thai-kitchen.com)
- `soy_sauce_all_purpose` — Western sources (recipetineats.com etc.)

Heuristic: unqualified "soy sauce" → `soy_sauce_light` if `cuisine_source === 'asian'`.

## API Routes

| Route | Method | Body | Response | Note |
|-------|--------|------|----------|------|
| `/api/extract` | POST | `{ url }` | `{ recipe, saved }` | Server-side fetch; auto-saves to the library (saved=false if DB unreachable) |
| `/api/normalize` | POST | `{ ingredients[], cuisine_source }` | `NormalizedIngredient[]` | Calls Claude in batch for unknowns |
| `/api/grocery-list` | POST | `{ recipes: [{ recipe, target_servings }] }` | `{ items, grouped_by_aisle }` | Full pipeline |
| `/api/recipes` | GET | — | `{ recipes: RecipeSummary[] }` | Saved-recipe library list |
| `/api/recipes/[id]` | GET | — | `{ recipe }` | Full saved recipe |
| `/api/recipes/[id]` | PUT | `{ title?, base_servings?, ingredients?, instructions?, notes? }` | `{ recipe }` | Persist user edits; flags the recipe `edited` |
| `/api/recipes/[id]` | DELETE | — | `{ ok: true }` | Remove from library |

## Recipe Library (Postgres + Prisma)

`prisma/schema.prisma` — one `recipes` table; `ingredients`/`instructions` are JSONB
documents (the app only consumes whole `Recipe` objects, nothing queries inside the
JSON). `url` is unique for dedupe; `/api/extract` upserts by normalized URL (trailing
slash, utm params, and hash stripped) and keeps the existing row's id on re-extract.

**User customization persists.** Recipes carry a nullable `notes` column and an
`edited` boolean. `PUT /api/recipes/[id]` → `updateRecipe()` saves edits
(title/servings/ingredients/instructions/notes) and sets `edited = true`. Once a
recipe is `edited`, `upsertRecipeByUrl()` treats a re-extract of the same URL as a
no-op so the user's customization is never clobbered. (Edited ingredient `raw_text`
is re-parsed client-side via `parseIngredient()` and `canonical_id` reset to null so
the grocery pipeline re-normalizes.)

All DB access goes through `src/lib/db/recipes.ts` — the single place to add a
`userId` filter when multi-user lands (plus one migration: `url @unique` →
`@@unique([url, user_id])`; the nullable `user_id` column already exists).

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

**Output units are always metric (ml, g, kg) or cups/spoons — never oz/lb.**
Imperial units (oz, lb) are parsed on the *input* side because imperial recipes
(e.g. The Woks of Life) are written that way, but every `default_purchase_unit`
in the registry resolves to a metric or cup/spoon unit, so the grocery list a
user copies out never contains oz or lb. Enforced by a regression test in
`tests/pipeline.test.ts`.

## Aisle Taxonomy

`produce` | `meat` | `seafood` | `dairy` | `deli` | `bakery` | `frozen` | `asian_grocery` | `pantry` | `condiments` | `beverages` | `other`

`asian_grocery` is intentionally separate from `pantry` — many shopping trips genuinely split across two stores.

## Implementation Status

- [x] Task 1: Project scaffold + CLAUDE.md
- [x] Task 2: Type definitions
- [x] Task 3: Unit conversion + parser
- [x] Task 4: Canonical ingredient registry
- [x] Task 5: Text cleaning + normalization lookup
- [x] Task 6: Schema.org extractor + test fixtures
- [x] Task 7: LLM normalization fallback
- [x] Task 8: Pipeline (extract + normalize + aggregate + purchase)
- [x] Task 9: API routes
- [x] Task 10: localStorage helpers
- [x] Task 11: UI components + main page
- [x] Task 12: Integration tests + final CLAUDE.md update
- [x] Task 13: Cooking-step extraction (`Recipe.instructions`)
- [x] Task 14: Shared recipe library (Postgres + Prisma, `/api/recipes`, auto-save on extract)
- [x] Task 15: Library picker UI + recipe detail view
- [x] Task 16: Instagram reel import (caption extraction + recipe heuristic gate)
