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
| `/api/recipes` | GET | — | `{ recipes: RecipeSummary[] }` | Saved-recipe library list. Non-admins only get `status = "tried_and_tested"`; admins get everything. Sends `Cache-Control: no-store` (body varies by cookie). |
| `/api/recipes/[id]` | GET | — | `{ recipe }` | Full saved recipe. Unfiltered by design — direct links to saved-for-later recipes stay viewable. |
| `/api/recipes/[id]` | PUT | `{ title?, base_servings?, ingredients?, instructions?, notes? }` | `{ recipe }` | Persist user edits; flags recipe `edited`. `status` is not accepted here. |
| `/api/recipes/[id]` | PATCH | `{ status }` | `{ recipe }` | Set curation status (`tried_and_tested` \| `saved_for_later`); deliberately does **not** flip `edited`. |
| `/api/recipes/[id]` | DELETE | — | `{ ok: true }` | Remove from library. |
| `/api/admin/login` | POST | `{ password }` | `{ ok: true }` \| 401 \| 500 | Sets HMAC-signed HttpOnly `sc_admin` cookie; 500 if `ADMIN_SESSION_SECRET` misconfigured. |
| `/api/admin/logout` | POST | — | 303 → `/` | Clears session cookie. |

## Admin gate

- **Write endpoints require auth:** `POST /api/extract`, `PUT`/`PATCH`/`DELETE /api/recipes/[id]` return **403** without a valid `sc_admin` cookie.
- **Public endpoints stay public:** all `GET` routes, `POST /api/normalize`, `POST /api/grocery-list` — so viewers can browse the library and build grocery lists from saved recipes.
- **Single guard**: `requireAdmin()` in `src/lib/auth.ts`. Any new write endpoint MUST call it.
- Session cookie is HMAC-signed with `ADMIN_SESSION_SECRET` (32+ random bytes). Verification is length-independent-time to avoid timing leaks.
