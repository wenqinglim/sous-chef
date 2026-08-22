#!/usr/bin/env node
/**
 * One-off backfill: auto-assign region/protein/base-ingredient tags to
 * existing recipes (mirrors src/lib/extractors/auto-tagger.ts, which runs
 * automatically on new imports going forward).
 *
 * Merges into each recipe's existing tags rather than overwriting — any
 * manually-added tags are preserved. Idempotent: safe to re-run, since a
 * repeat run re-derives the same auto-tags and normalizeTags() dedupes them
 * away as no-ops. Writes directly via prisma.recipe.update (not the app's
 * updateRecipe()) so it does NOT flip `edited` — this is a metadata
 * backfill, not a user edit.
 *
 * Usage:
 *   DATABASE_URL=... ANTHROPIC_API_KEY=... node scripts/backfill-tags.js
 */

const { PrismaClient } = require("@prisma/client");
const Anthropic = require("@anthropic-ai/sdk").default;
const registryData = require("../src/data/ingredients.json");

const prisma = new PrismaClient();
const anthropic = new Anthropic();

// ─── Ingredient registry (trimmed port of src/lib/registry/registry.ts +
//     src/lib/normalizers/lookup.ts — good enough for a one-off backfill;
//     recipe.ingredients[].name is already stripped of quantity/unit/prep). ──

function normaliseForLookup(s) {
  if (/[^\x00-\x7F]/.test(s)) return s.trim().replace(/\s+/g, " ");
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const byAlias = new Map();
for (const ingredient of registryData.ingredients) {
  if (!ingredient.tag_hints || ingredient.tag_hints.length === 0) continue;
  byAlias.set(normaliseForLookup(ingredient.name), ingredient.tag_hints);
  for (const alias of ingredient.aliases) {
    byAlias.set(normaliseForLookup(alias), ingredient.tag_hints);
  }
}

const STRIPPABLE_ADJECTIVES_RE =
  /^(?:fresh|dried|ground|whole|raw|cooked|frozen|thawed|canned|tinned|minced|chopped|sliced|grated|peeled|trimmed|crushed|small|medium|large|good|quality)\s+/i;

function inferIngredientTags(ingredients) {
  const tags = new Set();
  for (const ing of ingredients) {
    const name = normaliseForLookup(ing.name || "");
    const hints = byAlias.get(name) ?? byAlias.get(name.replace(STRIPPABLE_ADJECTIVES_RE, "").trim());
    if (hints) for (const tag of hints) tags.add(tag);
  }
  return Array.from(tags);
}

// ─── Region tags (mirrors auto-tagger.ts's inferRegionTags) ─────────────────

const REGION_TAGS = [
  "Italian", "Chinese", "Japanese", "Korean", "Thai", "Vietnamese",
  "Singaporean", "Malaysian", "Indonesian", "Indian", "Mexican", "French",
  "Greek", "Spanish", "Middle Eastern", "Mediterranean", "American",
  "British", "Filipino",
];

const SYSTEM_PROMPT = `You classify a recipe's cuisine of origin. Given a recipe's title and main ingredients, pick 0-2 region tags from this fixed list ONLY:
${REGION_TAGS.join(", ")}

Return ONLY valid JSON (no markdown, no extra text):
{ "region_tags": [{ "tag": "Chinese", "confidence": 0.9 }] }

Rules:
- tag must be exactly one of the listed values — never invent a new one.
- Only include a tag if you're genuinely confident (confidence >= 0.7); if the cuisine is ambiguous or unclear, return an empty array.
- Most recipes have exactly one clear region; only use two when the dish is a genuine fusion (e.g. Chinese-American).`;

/** Mirrors extractJsonText() in src/lib/extractors/llm-fallback.ts. */
function extractJsonText(raw) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  const body = fenced ? fenced[1].trim() : trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start !== -1 && end > start) return body.slice(start, end + 1);
  return body;
}

async function inferRegionTags(title, ingredientNames) {
  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: `Title: ${title}\nMain ingredients: ${ingredientNames.slice(0, 10).join(", ") || "(none listed)"}`,
        },
      ],
      system: SYSTEM_PROMPT,
    });
    const content = message.content[0];
    if (content.type !== "text") return [];
    const parsed = JSON.parse(extractJsonText(content.text));
    const regionTags = Array.isArray(parsed.region_tags) ? parsed.region_tags : [];
    return regionTags
      .filter((t) => REGION_TAGS.includes(t.tag) && typeof t.confidence === "number" && t.confidence >= 0.7)
      .slice(0, 2)
      .map((t) => t.tag);
  } catch (err) {
    console.error(`  region tag inference failed: ${err.message}`);
    return [];
  }
}

/** Mirrors normalizeTags() in src/lib/db/recipes.ts. */
function normalizeTags(tags) {
  const seen = new Set();
  const result = [];
  for (const tag of tags) {
    const trimmed = tag.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function sameTags(a, b) {
  if (a.length !== b.length) return false;
  const bLower = new Set(b.map((t) => t.toLowerCase()));
  return a.every((t) => bLower.has(t.toLowerCase()));
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set — aborting.");
    process.exit(1);
  }

  const rows = await prisma.recipe.findMany();
  console.log(`Found ${rows.length} recipe(s).`);

  let updated = 0;
  for (const row of rows) {
    const ingredients = Array.isArray(row.ingredients) ? row.ingredients : [];
    const ingredientTags = inferIngredientTags(ingredients);
    const regionTags = await inferRegionTags(row.title, ingredients.map((i) => i.name).filter(Boolean));

    const existing = Array.isArray(row.tags) ? row.tags : [];
    const merged = normalizeTags([...existing, ...regionTags, ...ingredientTags]);

    if (sameTags(merged, existing)) {
      console.log(`Unchanged: ${row.title}`);
      continue;
    }

    await prisma.recipe.update({ where: { id: row.id }, data: { tags: merged } });
    updated++;
    console.log(`Tagged: ${row.title} -> [${merged.join(", ")}]`);
  }

  console.log(`Done. Updated ${updated}/${rows.length} recipe(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
