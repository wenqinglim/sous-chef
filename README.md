# Sous-Chef

Turn recipe URLs into a grocery list. Add recipes with serving sizes, confirm the parsed ingredients, and copy a checklist straight into Google Keep.

Works best with [RecipeTin Eats](https://recipetineats.com), [The Woks of Life](https://thewoksoflife.com), [Hot Thai Kitchen](https://hot-thai-kitchen.com), and [Made With Lau](https://madewithlau.com).

## Local development

### Prerequisites

- Node.js 18+
- An [Anthropic API key](https://console.anthropic.com/) (used as fallback only — most recipes extract without it)

### Setup

```bash
git clone https://github.com/wenqinglim/sous-chef.git
cd sous-chef
npm install
cp .env.local.example .env.local
```

Edit `.env.local` and add your API key:

```
ANTHROPIC_API_KEY=sk-ant-...
```

### Run

```bash
npm run dev      # http://localhost:3000
npm test         # run all 154 tests
npm run build    # production build
```

## How it works

1. **Add recipes** — paste a URL and set the desired serving size. The app fetches the page server-side and extracts ingredients from the schema.org JSON-LD markup.
2. **Confirm ingredients** — review the parsed ingredient list before processing. Edit anything that looks wrong.
3. **Get your list** — ingredients are normalised, quantities aggregated across recipes, and rounded up to purchase units. Copy the result into Google Keep; each line becomes a checkbox.

## Tech stack

- [Next.js 15](https://nextjs.org) (App Router, TypeScript)
- [Tailwind CSS](https://tailwindcss.com)
- [Claude API](https://anthropic.com) (`@anthropic-ai/sdk`) — fallback extraction and normalization
- [cheerio](https://cheerio.js.org) — server-side HTML parsing
- [Jest](https://jestjs.io) + ts-jest — test suite (154 tests)
