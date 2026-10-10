---
name: orion-context
description: Use when committing or reviewing code changes, to keep the Orion context map in sync. Applies the "+." agent private rule from .gitignore and writes plain-language feature cards for sales.
---

# Orion context

Orion is a shared map of what the org is working on. Every code change you make should show up there as a short feature card that a salesperson can read and repeat. Some paths are private and must never show up anywhere.

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
