---
name: orion-context
description: Use at the start of any coding task to pull live org context from the Orion MCP server into .orion/context.md, and when committing or reviewing code changes to keep the Orion context map in sync. Applies the "+." agent private rule from .gitignore and writes plain-language feature cards for sales.
---

# Orion context

Orion is a shared map of what the org is working on. Teammates' browser captures (Google Ads, HubSpot, docs, consoles) and commits keep it current. Pull from it before you start a task, and push to it when you ship. Some paths are private and must never show up anywhere.

## 1. Start every task with Orion context

If the `orion` MCP server is connected (setup: `docs/mcp.md`), do this before planning or editing code:

1. Call `context_for_task` with the task in the user's own words. Add the feature name, ticket, or file area if you know it. Defaults are fine; pass `sinceHours` to look further back.
2. The result has two text blocks. Write the first one, unchanged, to `.orion/context.md` at the repo root (create `.orion/`, overwrite the file). The second is JSON with `write_to`, `itemIds`, and `sourceIds`. Never commit `.orion/`.
3. Read `.orion/context.md` and act on it:
   - Status flips (`-> **blocked**`, `at risk`) and blockers under "Upstream" change what to build first. Tell the user when the task depends on blocked work.
   - When an excerpt matters for the code, call `read_document` with its source id (`src-...` or `dg-...`). It returns the full page text or diff plus text read off the screenshot.
   - Call `graph_neighborhood` on an item id to see what blocks, feeds, or contains it, with owners.
   - Call `search_context` for anything the file did not cover, and `whats_new` to catch up on recent changes by others.
4. When you rely on a source, cite its ref (URL or `repo@sha`).

If the task changes direction, call `context_for_task` again with the new task and overwrite the file. If the server is not connected, skip this section and carry on.

## 2. Respect agent private paths

Read the root `.gitignore` before touching anything. Any line that starts with `+.` marks an agent private path:

```
+./src/features/secret-pricing-engine/
```

Strip the `+.` to get a gitignore pattern anchored at the repo root (`/src/features/secret-pricing-engine/`). Git does not protect these paths. You do.

For every private path:

- Do not open, read, grep, or summarize files under it, unless the user explicitly asks you to work inside it.
- If you do work inside it, never mention its contents, names, or purpose in feature cards, commit messages, PR descriptions, or anything sent to Orion.
- Never list it in a card's `paths`.

Always treat these as private too: `.env*`, `*.pem`, `*.key`, lockfiles, `node_modules/`.

## 3. Write feature cards

After a change a customer would notice (new feature, behavior change, visible fix), write `.ctx-cards.json` at the repo root. Skip refactors, formatting, and test-only changes. Write one card per user-visible change, usually one to three:

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

- `label`: at most 40 characters, sentence case, says what the user gets.
- `summary`: at most 140 characters, in plain words a salesperson understands. No code names, file names, or jargon. No em dashes or exclamation marks.
- `status`: `shipped` (live for customers), `in_beta` (some customers can use it), or `in_progress` (not usable yet).
- `paths`: the non-private files the card is about.

If `.ctx-cards.json` already exists, add to it instead of replacing it.

## 4. Sync

After committing, run from the repo root:

```
npm run ctx:sync              # send
npm run ctx:sync -- --dry-run # preview, send nothing
```

It reads the server URL and API token from `BACKEND_URL` and `ORION_TOKEN` (see `codebase-agent/README.md`). If they are not set and the sync fails to connect or gets a 401, tell the user rather than retrying. The script filters private paths again on its own, sends the diffs plus your cards to Orion, then deletes `.ctx-cards.json`. "Nothing to sync" means the change only touched private or excluded paths, which is expected.
