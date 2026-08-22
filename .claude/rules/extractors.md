---
paths:
  - "src/lib/extractors/**/*.ts"
  - "src/lib/recipe/sections.ts"
  - "src/app/api/extract/**"
---

# Extractors — Instagram, blocked sites, sections

## Bot-blocked recipe sites (Cloudflare 403)

Some recipe sites (e.g. **natashaskitchen.com**) sit behind Cloudflare Bot Management, which scores requests on **TLS/JA3 fingerprint + IP reputation**, not just headers. Node `fetch` has a non-browser TLS fingerprint and Vercel runs on datacenter IPs → `safeFetch` gets a `403` no matter how complete the browser headers are. `safe-fetch.ts`'s `BROWSER_FINGERPRINT_HEADERS` handle header-only sniffers but **cannot** clear a TLS+IP challenge.

Fix: when direct fetch returns `403`/`429`/`503`, `/api/extract` re-fetches HTML via `fetchPageHtmlViaScraper` (`src/lib/extractors/page-scraper.ts`) — Apify **Website Content Crawler** in a real browser behind a **residential proxy**. That HTML then flows through the normal schema.org → LLM extraction path unchanged. Uses the same `APIFY_TOKEN` as the Instagram scraper. Returns `null` (→ clear error + paste fallback) when unconfigured or the scrape yields nothing. A plain `404` does **not** trigger the scraper.

## Instagram reels

Instagram pages have no recipe JSON-LD, so `/api/extract` detects Instagram URLs (`isInstagramUrl`) and branches to `src/lib/extractors/instagram.ts`. Assumption: **the reel caption contains the full recipe**.

Flow:
1. `fetchInstagramMedia(url)` (scraper → `{ caption, videoUrl }`)
2. `looksLikeRecipe(caption)` — recipe keyword OR ≥3 quantity+unit matches; rejects non-recipe captions before spending an LLM call.
3. `extractWithLlm(caption, url)` → `cuisine_source = "unknown"`.

**Fetching goes through a scraper, not our IP.** Instagram login-walls both caption and video for datacenter IPs. Personal `sessionid` cookies are fragile and risky. So reel fetching is delegated to Apify's `apify/instagram-scraper` actor (synchronous run endpoint, one POST returns caption + CDN MP4 URL). Reads `APIFY_TOKEN`. The provider sits behind an `InstagramMedia` interface so a faster RapidAPI endpoint can drop in without touching callers.

**Audio fallback** — `extractFromInstagramWithAudio(url, onStatus)`: when caption is absent/incomplete, download `videoUrl` via `binaryFetch` (24 MB cap, CDN-only), transcribe with Groq Whisper (`whisper-large-v3`), run transcript through same LLM extractor. Degrades gracefully — partial caption is saved rather than erroring if audio fails.

**Manual caption paste (the $0 fallback)** — `/api/extract` also accepts `{ text }` (optionally with `url`): pasted caption skips all fetching and goes straight to `extractWithLlm`. `AddRecipeForm` exposes "Paste the caption instead" and auto-opens it when an import errors. When `url` is given it's kept as the source link (and dedupe key); otherwise a unique `paste:<uuid>` url is synthesised.

Every step logs `[IG] …` (`console.error` → Vercel logs) and emits a human-readable `onStatus` message (→ SSE → UI), so a failed import shows which stage broke.

> **Operational note:** `APIFY_TOKEN` is a personal Apify API token (console.apify.com → Settings → API & Integrations). Free tier ($5/mo credit) covers personal use. If reel imports start failing, check Apify run logs / remaining credit.

## Automatic recipe tagging

`src/lib/extractors/auto-tagger.ts` assigns tags the moment a recipe is imported, via `inferAutoTags()` called once in `saveExtracted()` — the single choke point all three `/api/extract` paths (schema.org, LLM-fallback, Instagram) funnel through before `upsertRecipeByUrl`. Two independent signal sources, both near-zero cost, tuned for precision over recall (an untagged recipe beats a wrong tag):

- **Protein / base-ingredient tags** (`inferIngredientTags`) — deterministic, $0. Runs every raw ingredient name through the same `lookupIngredient()` registry lookup the normalization pipeline uses, and collects the matched entries' `tag_hints` (see `.claude/rules/normalization.md`). No LLM call; misses ingredients outside the registry rather than guessing.
- **Region/cuisine tags** (`inferRegionTags`) — one small Haiku call per import (same `claude-haiku-4-5-20251001` / zod-validated-JSON / fail-gracefully-to-`[]` pattern as `time-estimator.ts` and `normalizers/llm-fallback.ts`). Constrained to a closed vocabulary (`REGION_TAGS` in `auto-tagger.ts`) via a zod enum, and gated at confidence ≥ 0.7, capped at 2 tags.

`upsertRecipeByUrl(recipe, { autoTags })` (`src/lib/db/recipes.ts`) writes `autoTags` only into the upsert's `create` branch, so auto-tagging applies exactly once on first import — a re-extract of an existing URL never overwrites tags an admin has since edited.

Existing recipes were backfilled once via `scripts/backfill-tags.js` (merges into existing tags, doesn't overwrite manual ones — safe to re-run).

## Recipe sections are preserved, not flattened

Recipes group ingredients/steps under subheadings (e.g. "For the sauce"). Each `RecipeIngredient` and `InstructionStep` carries an optional `section` label. Detail/editor UIs render consecutive same-label runs under that heading (`groupBySection` in `src/lib/recipe/sections.ts`).

Sources of the label:
- **Instructions**: schema.org `HowToSection.name` (captured by `parseInstructions`) for all sites; the LLM path supplies it too.
- **Ingredients**: JSON-LD `recipeIngredient` is flat, so for schema.org sites labels are mined from recipe-plugin HTML (WP Recipe Maker / Tasty Recipes) via `extractIngredientGroups` + `assignIngredientSections` (index-align when counts match, else text-match, else null). The LLM path supplies them directly.

**The grocery pipeline ignores `section` entirely** — it still flattens and aggregates by `canonical_id`, so sectioning is display-only.
