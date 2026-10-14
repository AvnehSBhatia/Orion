---
name: orion-context
description: Use at the start of any coding task to pull live org context from the Orion MCP server into .orion/context.md, and when committing or reviewing code changes to keep the Orion context map in sync. Applies the "+." agent private rule from .gitignore and writes plain-language feature cards for sales.
---

# Orion context

Orion is a shared map of what the org is working on, kept current by teammates' browser captures (Google Ads, HubSpot, docs, consoles) and commits. Pull from it before you start, and push to it when you ship. Some paths are private and must never show up anywhere.

## 0. Start every task with Orion context

If the `orion` MCP server is connected (see `docs/mcp.md`), do this before planning or editing code:

1. Call `context_for_task` with the task in the user's own words (add the feature name, ticket, or file area if you know it). Defaults are fine; pass `sinceHours` to look further back.
2. Write the first text block of the result, unchanged, to `.orion/context.md` at the repo root (create `.orion/`, overwrite the file). The second block is JSON with `write_to`, `itemIds`, and `sourceIds`. Do not commit `.orion/`.
3. Read `.orion/context.md`. Act on it:
   - Status flips (`-> **blocked**`, `at risk`) and blockers under "Upstream" change what you should build first. Tell the user when the task depends on blocked work.
   - Call `read_document` with a source id (`src-...` or `dg-...`) when an excerpt matters for the code: it returns the full page text or diff plus text read off the screenshot.
   - Call `graph_neighborhood` on an item id to see what blocks, feeds, or contains it, with owners.
   - Call `search_context` for anything the file did not cover, and `whats_new` to catch up on recent changes by others.
4. Cite sources by their ref (URL or `repo@sha`) when you rely on them.

If the task changes direction mid-way, call `context_for_task` again with the new task and overwrite the file. If the server is not connected, skip this step and carry on.

## 1. Respect agent private paths

Read the root `.gitignore` before touching anything. Any line that starts with `+.` marks an agent private path:

```
+./src/features/secret-pricing-engine/
```

Strip the `+.` to get the path, relative to the repo root (`/src/features/secret-pricing-engine/`). Git ignores these lines, so it does not protect them. You do.

For every private path:

- Do not open, read, grep, or summarize files under it, unless the user explicitly asks you to work inside that path.
- If you do work inside it, never mention its contents, names, or purpose in feature cards, commit messages, PR descriptions, or anything sent to Orion.
- Never list a private path in a card's `paths`.

Always treat these as private too: `.env*`, `*.pem`, `*.key`, lockfiles, `node_modules/`.

## 2. Write feature cards

After a meaningful change (new feature, behavior change, fix a customer would notice), write `.ctx-cards.json` at the repo root. Skip refactors, formatting, and test-only changes. One card per user-visible change, usually one to three cards:

```json
[
  {
    "label": "One click checkout for saved cards",
    "summary": "Customers with a saved card can now pay in one click. No extra setup needed.",
    "status": "shipped",
    "paths": ["src/features/checkout/index.ts"]
  }
]
```

Rules:

- `label`: 40 characters max, sentence case, says what the user gets.
- `summary`: 140 characters max. Plain words a salesperson understands. No code names, file names, or jargon. No em dashes, no exclamation marks.
- `status`: `shipped` (live for customers), `in_beta` (some customers can use it), or `in_progress` (not usable yet).
- `paths`: the non-private files the card is about.

If `.ctx-cards.json` already exists, add to it rather than replacing it.

## 3. Sync

After committing, run:

```
npm run ctx:sync
```

To preview what would be sent without sending it:

```
npm run ctx:sync -- --dry-run
```

The script filters private paths again on its own, sends the diffs plus your cards to the backend, then deletes `.ctx-cards.json`. If it says "Nothing to sync", the change only touched private or excluded paths, which is expected.
