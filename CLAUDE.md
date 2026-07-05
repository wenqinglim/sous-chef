# Sous-Chef — Developer Guide

## What this app is

A **recipe library** with a grocery-list side quest. The home page (`/`) lists saved recipes (Postgres); open one to read/customize it. Import from any URL (schema.org JSON-LD; Claude fallback; Instagram reels via caption/audio). A secondary route (`/grocery-list`) scales + aggregates ingredients across picked recipes into a Google-Keep-flavored checklist.

## Pages / routes

| Route | Purpose |
|-------|---------|
| `/` | Recipe library grid (`RecipeLibraryGrid`) + URL importer (`AddRecipeForm`). |
| `/recipes/[id]` | Single-recipe detail (`RecipeView`) + customize editor (`RecipeEditor`). |
| `/grocery-list` | Build-a-grocery-list wizard + saved-recipe picker. |

Shared chrome (`SiteHeader`) in `src/app/layout.tsx`.

## Tech stack

Next.js 15 App Router · TypeScript · Tailwind · Postgres (Neon) + Prisma 6 · Claude (`@anthropic-ai/sdk`) · Jest + ts-jest · cheerio.

## Environment (`.env.local`)

`ANTHROPIC_API_KEY`, `DATABASE_URL`, `GROQ_API_KEY` (Whisper), `APIFY_TOKEN` (Instagram + blocked-site scraper), `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET` (32+ random bytes; `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).

## Running locally

```bash
npm install
npm run db:deploy     # apply Prisma migrations
npm run dev           # http://localhost:3000
npm test              # 432 tests; no DB needed (Prisma mocked)
npm run build         # prisma generate → migrate deploy → next build
```

`build` runs `prisma migrate deploy` so every Vercel deploy syncs prod schema — needs a reachable `DATABASE_URL`. For a build-only check without a DB, run `next build` directly and rely on `npm test`.

## Architecture — five-layer pipeline

Layers have stable output shapes and never talk backwards.

```
URL → [1] Extraction        schema.org JSON-LD (cheerio) → Claude fallback → residential scraper (blocked sites)
    → [2] Normalization     alias lookup (src/lib/registry/) → Claude batch fallback; metric conversion, soy-sauce disambiguation
    → [3] Aggregation       pure math; sum by canonical_id in base units (ml, g, each)
    → [4] Purchase Planning ceil to purchase units; emits leftover_quantity, aisle, is_staple (all fields always populated)
    → [5] Presentation      flat checklist + copy button
```

## Key design decisions

- **Grocery list is derived, never persisted.** `list = derive(MealPlan, cachedRecipes)`. Edit inputs → recompute output. No sync bugs.
- **All `PurchaseItem` fields computed from day one** (`leftover_quantity`, `aisle`, `is_staple`), even if MVP UI hides some. Post-MVP features just read fields that already exist.
- **MealPlan lives in localStorage in MVP.** Shape: `{ id, name: null, recipes: [{ recipe_id, target_servings }] }`. "Saved meal plans" post-MVP = add `name` + server persistence.
- **Manual edit step is part of the MVP** — after parsing, user confirms ingredients before processing.
- **Recipe sections are preserved, not flattened.** Grouping is display-only; the grocery pipeline still flattens + aggregates by `canonical_id`.
- **Output units are always metric** (ml, g, kg) or cups/spoons — never oz/lb. Enforced by a pipeline regression test.

## Core rules

- **Single-user for now.** Nullable `user_id` reserved; all DB access goes through `src/lib/db/recipes.ts` — the single place to add a `userId` filter when multi-user lands.
- **All write endpoints** (`POST /api/extract`, `PUT`/`DELETE /api/recipes/[id]`) must call `requireAdmin()` in `src/lib/auth.ts`.
- **All LLM responses must be JSON** — never parse free text. `extractJsonText` unwraps markdown/prose-wrapped responses.
- **Fail gracefully.** Scrapers return `null` (→ clear error + paste fallback) rather than throwing. Never hard-fail an extraction on a downstream API blip.

## Recipe sources

All four have clean schema.org JSON-LD — Claude fallback should rarely fire:
recipetineats.com (metric, AU) · thewoksoflife.com (imperial, `cuisine_source=asian`) · hot-thai-kitchen.com (metric, Thai script in parens) · madewithlau.com (mixed, Chinese chars in parens).

## Rules that load conditionally

- `.claude/rules/api-and-auth.md` — full API route table + admin gate details. Loads on `src/app/api/**` and `src/lib/auth.ts`.
- `.claude/rules/prisma-db.md` — schema, upsert flow, edit-guard, multi-user path. Loads on `prisma/**` and `src/lib/db/**`.
- `.claude/rules/data-model.md` — full TS type definitions. Loads on types, pipeline, extractors, normalizers, `prisma/schema.prisma`.
- `.claude/rules/extractors.md` — Instagram reel flow, Cloudflare/Apify blocked-site fallback, section extraction. Loads on `src/lib/extractors/**` and `src/lib/recipe/sections.ts`.
- `.claude/rules/normalization.md` — units, aisles, canonical ingredient registry, soy-sauce disambiguation. Loads on `src/lib/registry|normalizers|units|pipeline` and `src/data/ingredients.json`.
- `.claude/rules/testing.md` — 16-suite index + 10-step manual verification checklist. Loads on `tests/**` and `**/*.test.ts`.
