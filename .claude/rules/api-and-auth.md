---
paths:
  - "src/app/api/**/*.ts"
  - "src/lib/auth.ts"
---

# API routes and admin auth

## Routes

| Route | Method | Body | Response | Note |
|-------|--------|------|----------|------|
| `/api/extract` | POST | `{ url?, text? }` | SSE: `status` / `result {recipe, saved}` / `error` | URL → fetch+extract (websites schema.org, IG via scraper); `text` → extract pasted caption with no fetch. Auto-saves (`saved=false` if DB unreachable). |
| `/api/normalize` | POST | `{ ingredients[], cuisine_source }` | `NormalizedIngredient[]` | Calls Claude in batch for unknowns. |
| `/api/grocery-list` | POST | `{ recipes: [{ recipe, target_servings }] }` | `{ items, grouped_by_aisle }` | Full pipeline. |
| `/api/recipes` | GET | — | `{ recipes: RecipeSummary[] }` | Saved-recipe library list. |
| `/api/recipes/[id]` | GET | — | `{ recipe }` | Full saved recipe. |
| `/api/recipes/[id]` | PUT | `{ title?, base_servings?, ingredients?, instructions?, notes? }` | `{ recipe }` | Persist user edits; flags recipe `edited`. |
| `/api/recipes/[id]` | DELETE | — | `{ ok: true }` | Remove from library. |
| `/api/admin/login` | POST | `{ password }` | `{ ok: true }` \| 401 \| 500 | Sets HMAC-signed HttpOnly `sc_admin` cookie; 500 if `ADMIN_SESSION_SECRET` misconfigured. |
| `/api/admin/logout` | POST | — | 303 → `/` | Clears session cookie. |

## Admin gate

- **Write endpoints require auth:** `POST /api/extract`, `PUT`/`DELETE /api/recipes/[id]` return **403** without a valid `sc_admin` cookie.
- **Public endpoints stay public:** all `GET` routes, `POST /api/normalize`, `POST /api/grocery-list` — so viewers can browse the library and build grocery lists from saved recipes.
- **Single guard**: `requireAdmin()` in `src/lib/auth.ts`. Any new write endpoint MUST call it.
- Session cookie is HMAC-signed with `ADMIN_SESSION_SECRET` (32+ random bytes). Verification is length-independent-time to avoid timing leaks.
