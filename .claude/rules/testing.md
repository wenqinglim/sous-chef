---
paths:
  - "tests/**/*.ts"
  - "**/*.test.ts"
  - "jest.config.*"
---

# Testing

`npm test` — 446 tests across 16 suites; Prisma is mocked (no DB needed).

## Suite map

| Suite | Covers |
|---|---|
| `tests/auth.test.ts` | Session HMAC (sign/verify, tamper, expiry, non-hex, missing/short secret) + `verifyPassword` (correct/wrong, unset, timing-safe, missing-secret throws) + `isAdmin()` with mocked `next/headers` cookies. |
| `tests/api-auth.test.ts` | `POST /api/extract`, `PUT`/`PATCH`/`DELETE /api/recipes/[id]` return 403 for anonymous; `GET /api/recipes/[id]` stays public; valid signed cookie passes the guard; `GET /api/recipes` filters saved_for_later for non-admins; PUT rejects status-only bodies; PATCH validates the status enum. |
| `tests/units.test.ts` | Unit conversions + ingredient text parser, incl. mixed/unicode ranges. |
| `tests/normalization.test.ts` | Registry lookup, alias matching, soy sauce disambiguation, messy-name robustness. |
| `tests/extraction.test.ts` | Schema.org extraction for all 4 target sites + `parseInstructions` for every JSON-LD instruction shape (incl. `HowToSection` → step section labels) + `extractIngredientGroups`/`assignIngredientSections` (WPRM + Tasty Recipes ingredient-group HTML → ingredient sections). |
| `tests/sections.test.ts` | `normalizeInstructions` (legacy `string[]` → `InstructionStep[]`) + `groupBySection` consecutive-run grouping. |
| `tests/instagram.test.ts` | Instagram URL detection (`isInstagramUrl`) + recipe heuristic gate (`looksLikeRecipe`). |
| `tests/instagram-scraper.test.ts` | `fetchInstagramMedia` request shape + caption/videoUrl parsing + degradation (unconfigured token, empty/non-array/non-ok responses). |
| `tests/instagram-audio.test.ts` | Host-validated `binaryFetch` (CDN-only, size cap, diagnostics), Whisper (mocked), `extractFromInstagramWithAudio` orchestration (caption→audio fallback, caption+transcript merge, graceful degradation). |
| `tests/extract-route.test.ts` | `/api/extract` pasted-text branch (direct LLM extraction, url passthrough/synthesis, no fetching) + website 403→scraper fallback (retry, error passthrough, no scraper on 404). |
| `tests/page-scraper.test.ts` | `fetchPageHtmlViaScraper` request shape (residential proxy, saveHtml) + HTML parsing + degradation. |
| `tests/llm-fallback.test.ts` | `extractJsonText` unwraps markdown-fenced / prose-wrapped LLM JSON responses. |
| `tests/rescale.test.ts` | Ingredient quantity rescaling by servings. |
| `tests/pipeline.test.ts` | Aggregate + purchase planning + full `derive()`; purchase-unit + slice→weight + metric-output regressions. |
| `tests/safe-fetch.test.ts` | SSRF protections. |
| `tests/recipes-repo.test.ts` | Recipe repository mappers + mocked-Prisma flows (upsert id retention, URL dedupe, summaries, `updateRecipe` edits, edited-recipe re-extract guard, status filtering in `listRecipes`, `setRecipeStatus`/`setRecipeTags` never flip `edited`, upsert never writes status or tags). |
| `tests/recipe-filter.test.ts` | `filterSummaries()` (`src/lib/recipe-filter.ts`) — title search, single/multiple tag OR-match, empty selection = no filtering. |

## Manual verification checklist (before releasing a UI change)

0. **Library home**: on `/`, paste a RecipeTin Eats URL into "Add a recipe" → lands on `/recipes/[id]`; card appears on `/`.
1. **Detail view**: open a saved recipe → title, ingredients, numbered steps render; "View original recipe ↗" opens `recipe.url` in new tab.
1a. **Customize**: "✏️ Customize" → edit an ingredient, add/remove a step, add a note → Save → reload: edits persist, "Customized" badge shows. Re-importing same URL no longer overwrites.
1b. **Status**: as admin, import a new recipe → "Saved for later" badge on its card; card badge (or detail-page button) toggles it to tried & tested; in an incognito window only tried & tested recipes appear on `/` and in the grocery picker, but a direct link to a saved-for-later recipe still renders (with badge). Toggling status must NOT add the "Customized" badge.
1c. **Tags**: as admin, open a recipe → add 2–3 tags via the chip editor → reload: tags persist, do NOT add the "Customized" badge. On `/`, the tag appears as a chip on the card and in the tag filter bar; clicking it narrows the grid to matching recipes; the search box filters by title. In an incognito window, tags render read-only (no editor) on the detail page.
2. **Single recipe (grocery)**: "Add to grocery list" → on `/grocery-list`, set 4 servings → ingredients render in review step.
3. **Scaling**: change servings to 6 → quantities reflect `target_servings`, not `base_servings`.
4. **Multi-recipe**: add a Woks of Life recipe alongside RecipeTin Eats → shared ingredients (garlic) aggregate into one line.
5. **Soy sauce**: Woks of Life recipe → soy sauce shows as "Soy Sauce (Light)".
6. **Copy to Google Keep**: click copy → paste into Google Keep → each line becomes a checkbox.
7. **Thai script**: Hot Thai Kitchen recipe → Thai characters in parentheses stripped from ingredient names.
8. **LocalStorage restore**: on `/grocery-list`, close and reopen browser → previously loaded recipes still there.
9. **Saved library picker**: on `/grocery-list`, pick from "Or pick from your saved recipes" → identical grocery list.
10. **DB down**: with `DATABASE_URL` unset, home grid degrades quietly, URL extraction still works (`saved: false`).

## When adding a test

- Prisma is mocked, not hit. Follow the pattern in `tests/recipes-repo.test.ts`.
- API route tests mock `next/headers` cookies for auth. See `tests/api-auth.test.ts`.
- New extraction paths → add a fixture under `tests/fixtures/` matching the existing shape.
