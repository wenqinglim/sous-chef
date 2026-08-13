---
paths:
  - "prisma/**"
  - "src/lib/db/**/*.ts"
---

# Prisma / Postgres — recipe library

`prisma/schema.prisma` — one `recipes` table. `ingredients` and `instructions` are JSONB documents (the app only consumes whole `Recipe` objects; nothing queries inside the JSON). `url` is unique for dedupe.

## Upsert flow

`/api/extract` calls `upsertRecipeByUrl()` in `src/lib/db/recipes.ts`. URL is normalised first (trailing slash, `utm_*` params, hash stripped). The existing row's `id` is retained on re-extract.

## User customisation persists

- Recipes carry a nullable `notes` column and an `edited` boolean.
- `PUT /api/recipes/[id]` → `updateRecipe()` saves edits (title/servings/ingredients/instructions/notes) and sets `edited = true`.
- Once `edited = true`, `upsertRecipeByUrl()` treats a re-extract of the same URL as a **no-op** so the user's customisation is never clobbered.
- Edited ingredient `raw_text` is re-parsed client-side via `parseIngredient()`, and `canonical_id` is reset to `null` so the grocery pipeline re-normalises.

## Curation status & tags

- `status` column: `"tried_and_tested" | "saved_for_later"`, defaults to `saved_for_later` for new imports (the 20260711 migration backfilled pre-existing rows to `tried_and_tested`).
- `listRecipes()` filters to `tried_and_tested` unless called with `{ includeUntried: true }` (admin-only, decided by the route via `isAdmin()`).
- `tags` column: `text[]`, defaults to `{}` (20260813 migration). Freeform, open-vocabulary — no admin-configured enum. Deduped case-insensitively per recipe on write (first-seen casing wins), but two recipes can still store the same tag under different casing — cross-recipe matching (library filter bar) folds case; see `src/lib/recipe-filter.ts`.
- Both are set via `setRecipeMetadata(id, { status?, tags? })` / `PATCH /api/recipes/[id]` — never through `updateRecipe()`, so it does **not** flip `edited`. Both fields are written in a single `prisma.recipe.update()` call so a request setting both at once is atomic.
- `upsertRecipeByUrl()` never writes `status` or `tags` (both excluded from `toRowData`), so a re-extract keeps the stored curation metadata.

## Multi-user migration path (single-user for now)

All DB access goes through `src/lib/db/recipes.ts` — the single place to add a `userId` filter when multi-user lands. The nullable `user_id` column already exists. Migration when the time comes: `url @unique` → `@@unique([url, user_id])`.

## Migrations

- `npm run db:deploy` applies pending migrations.
- `npm run build` runs `prisma migrate deploy` before `next build`, so every Vercel deploy syncs prod schema. Consequence: `npm run build` needs a reachable `DATABASE_URL`.
- For a build check without a DB, run `next build` directly and lean on `npm test` (Prisma is mocked in tests).
