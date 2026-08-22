---
paths:
  - "src/lib/registry/**/*.ts"
  - "src/lib/normalizers/**/*.ts"
  - "src/lib/units/**/*.ts"
  - "src/lib/pipeline/**/*.ts"
  - "src/data/ingredients.json"
---

# Normalization — units, aisles, ingredient registry

## Canonical ingredient registry

`src/data/ingredients.json` — ~300 entries. Schema version `1.0.0`.

**Soy sauce disambiguation** — two distinct IDs:
- `soy_sauce_light` — Chinese-cuisine sources (`woksoflife.com`, `madewithlau.com`, `hot-thai-kitchen.com`)
- `soy_sauce_all_purpose` — Western sources (`recipetineats.com`, etc.)

Heuristic: unqualified "soy sauce" → `soy_sauce_light` if `cuisine_source === 'asian'`.

**`tag_hints`** — an optional `string[]` on entries that represent a recipe's base protein or base carb (e.g. `chicken_breast` → `["Chicken"]`, `tofu_firm` → `["Tofu"]`, `rice_jasmine` → `["Rice"]`, `pasta_spaghetti` → `["Pasta"]`). Most entries (aromatics, sauces, spices) have no `tag_hints`. Read by `src/lib/extractors/auto-tagger.ts` to auto-assign protein/base-ingredient tags on import — see that module's doc comment and `.claude/rules/extractors.md`.

## Unit conversions (base units: ml, g, each)

| Unit | → ml | | Unit | → g |
|------|------|-|------|-----|
| tsp | 4.929 | | oz | 28.3495 |
| tbsp | 14.787 | | lb | 453.592 |
| fl oz | 29.574 | | kg | 1000 |
| cup | 236.588 | | g | 1 |
| pint | 473.176 | | | |
| L | 1000 | | | |

Special: stick of butter = 113g; 1 inch ginger ≈ 6g.

**Output units are always metric (ml, g, kg) or cups/spoons — never oz/lb.** Imperial units (oz, lb) are parsed on the *input* side because imperial recipes are written that way, but every `default_purchase_unit` in the registry resolves to a metric or cup/spoon unit. Enforced by a regression test in `tests/pipeline.test.ts`.

## Aisle taxonomy

`produce` | `meat` | `seafood` | `dairy` | `deli` | `bakery` | `frozen` | `asian_grocery` | `pantry` | `condiments` | `beverages` | `other`

`asian_grocery` is intentionally separate from `pantry` — many shopping trips genuinely split across two stores.
