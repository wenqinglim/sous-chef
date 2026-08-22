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

// ─── Ingredient registry lookup — full port of the matching algorithm in
//     src/lib/registry/registry.ts + src/lib/normalizers/lookup.ts (name
//     cleaning, adjective-stripping loop, singular variants). Not imported
//     directly: this is a plain CommonJS script with no path-alias/ts-node
//     setup, same constraint as scripts/backfill-times.js. If lookupIngredient
//     changes, mirror the change here too so backfill parity holds. ──────────

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
const tagHintsById = new Map();
for (const ingredient of registryData.ingredients) {
  if (!ingredient.tag_hints || ingredient.tag_hints.length === 0) continue;
  tagHintsById.set(ingredient.id, ingredient.tag_hints);
  byAlias.set(normaliseForLookup(ingredient.name), ingredient.id);
  for (const alias of ingredient.aliases) {
    byAlias.set(normaliseForLookup(alias), ingredient.id);
  }
}
// findByAlias must also see entries with no tag_hints, else an adjective/
// singular retry could "resolve" to an untagged entry when a tagged entry
// was the correct match at an earlier, unretried step.
const idByAlias = new Map();
for (const ingredient of registryData.ingredients) {
  idByAlias.set(normaliseForLookup(ingredient.name), ingredient.id);
  for (const alias of ingredient.aliases) idByAlias.set(normaliseForLookup(alias), ingredient.id);
}
function findByAlias(name) {
  return idByAlias.get(normaliseForLookup(name)) ?? null;
}

const STRIPPABLE_ADJECTIVES = [
  "fresh", "dried", "ground", "whole", "raw", "cooked", "frozen", "thawed",
  "canned", "tinned", "low-sodium", "low sodium", "reduced-sodium",
  "reduced sodium", "unsalted", "salted", "roasted", "toasted", "minced",
  "chopped", "sliced", "grated", "peeled", "trimmed", "crushed", "small",
  "medium", "large", "good", "quality",
];
const ADJECTIVE_RE = new RegExp(
  `^(?:${STRIPPABLE_ADJECTIVES.map((a) => a.replace("-", "[-\\s]?")).join("|")})\\s+`,
  "i"
);

function stripParentheticals(name) {
  return name.replace(/\s*\([^)]*\)/g, "").trim();
}

const LEADING_DETERMINER_RE =
  /^(?:half\s+of\s+a|half\s+a|half|a\s+few|a\s+pinch\s+of|a\s+handful\s+of|some|few|a|an|the)\s+/i;
const PURPOSE_PHRASE_RE =
  /\s+(?:for\s+(?:serving|garnish|the\s+\w+|dusting|drizzling)|to\s+(?:serve|garnish|finish)|plus\s+more.*|divided|as\s+needed|if\s+desired|optional)\s*$/i;

function stripDeterminersAndPurpose(name) {
  let s = name.trim();
  let prev = "";
  while (s !== prev) {
    prev = s;
    s = s.replace(LEADING_DETERMINER_RE, "").replace(PURPOSE_PHRASE_RE, "").trim();
  }
  return s;
}

function singularVariants(name) {
  const trimmed = name.trim();
  if (!trimmed) return [];
  const parts = trimmed.split(/\s+/);
  const last = parts[parts.length - 1];
  const prefix = parts.slice(0, -1).join(" ");
  const join = (w) => (prefix ? `${prefix} ${w}` : w);

  const wordVariants = new Set();
  if (last.endsWith("ies") && last.length > 3) {
    wordVariants.add(last.slice(0, -3) + "y");
    wordVariants.add(last.slice(0, -3) + "i");
    wordVariants.add(last.slice(0, -2));
  }
  if (last === "leaves") wordVariants.add("leaf");
  if (last.endsWith("es") && last.length > 2) wordVariants.add(last.slice(0, -2));
  if (last.endsWith("s") && last.length > 1) wordVariants.add(last.slice(0, -1));

  return Array.from(wordVariants)
    .filter((w) => w.length > 1)
    .map(join);
}

/** Full port of lookupIngredient() (minus soy sauce disambiguation, which has no tag_hints). */
function resolveIngredientId(rawName) {
  const name = stripDeterminersAndPurpose(stripParentheticals(rawName));

  const direct = findByAlias(name);
  if (direct) return direct;

  let stripped = name;
  let prev = "";
  while (stripped !== prev) {
    prev = stripped;
    stripped = stripped.replace(ADJECTIVE_RE, "").trim();
  }
  if (stripped !== name && stripped.length > 0) {
    const afterAdj = findByAlias(stripped);
    if (afterAdj) return afterAdj;
  }

  for (const candidate of [...singularVariants(name), ...singularVariants(stripped)]) {
    if (candidate.length <= 2) continue;
    const match = findByAlias(candidate);
    if (match) return match;
  }

  return null;
}

function inferIngredientTags(ingredients) {
  const tags = new Set();
  for (const ing of ingredients) {
    const id = resolveIngredientId(ing.name || "");
    const hints = id ? tagHintsById.get(id) : undefined;
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
