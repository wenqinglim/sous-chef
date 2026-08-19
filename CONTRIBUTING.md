# Contributing to Sous-Chef

You don't need a laptop — or to write code — to contribute. Every change here can be
made from your phone by describing what you want to Claude, our coding agent. A human
reviews and approves every pull request before anything goes live, so you can't break
the site.

## PRs from your phone, step by step

1. **Get access.** Install the [GitHub mobile app](https://github.com/mobile) (free) and
   accept your collaborator invite to this repository. Triggering Claude requires write
   access, so ask the repo owner for an invite if you don't have one.
2. **Describe the task.** In the app: this repo → Issues → **New issue** → pick
   **"🤖 Ask Claude to build something"**. Fill in the form — the required fields walk
   you through everything Claude needs.
3. **Wait a few minutes.** Claude replies on the issue with its progress, implements the
   change on a `claude/**` branch, and posts a **"Create PR"** link. Tap it to open the
   pull request.
4. **Review happens automatically.** When the PR opens, Claude reviews it against the
   project's conventions and comments on anything off. The repo owner approves and merges.
5. **Want tweaks?** Comment `@claude make the button green instead` on the issue or on
   the PR — same conversation, same agent. After follow-up changes land, comment
   `@claude review the latest changes` to get a fresh review (the automatic one only
   covers the PR as it was opened).

## Writing a good task (this is prompting practice!)

Working with a coding agent is a skill, and the form teaches its core moves: say **what**
you want, **where** it goes, and **how you'll know it worked** — then set boundaries.

**A good request:**

> On the grocery list page, add a "clear checked items" button below the checklist.
> When I tap it, checked items disappear and the copied list doesn't include them.
> Don't change how ingredients are added up.

**A request that will disappoint:**

> Make the grocery list better.

Tips that consistently pay off:

- **One idea per issue.** "Add a button" and "also redesign the header" are two issues.
  Small asks produce small PRs, which get reviewed and merged fast.
- **Screenshots beat paragraphs.** Attach a screenshot and mark up what you want changed —
  it's the fastest way to show the agent what you mean.
- **"UI" vs "backend":** the UI is what you can see (buttons, layout, text, colors); the
  backend is what happens invisibly (saving, importing recipes, calculating quantities).
  Saying which one you mean helps — but "not sure" is always an acceptable answer.
- **Admin vs visitor:** the admin logs in to import and edit recipes; visitors just
  browse. If your feature is admin-only, say so — it needs to live behind the login.

## Prefer your own agent?

[Google Jules](https://jules.google) is a free coding agent that works from a mobile
browser with your own Google account: it clones the repo, makes the change, and opens
the PR itself. Ask the repo owner to grant the Jules GitHub app access if you'd like to
use it.

## For developers with a laptop

The classic route still works: branch, code, PR. See [CLAUDE.md](CLAUDE.md) for the
architecture guide, environment setup, and project conventions (`npm install`,
`npm run db:deploy`, `npm run dev`, `npm test`).
