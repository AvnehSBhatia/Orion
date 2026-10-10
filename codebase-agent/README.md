# Constellation codebase agent (Team B)

Turns code changes into updates for the company context map, and keeps anything marked private out of it.

## Setup

```
cd codebase-agent
npm install
```

## The plus-dot rule

In the root `.gitignore`, a line starting with `+.` means "agents must not read or publish this path":

```
+./demo/src/features/secret-pricing-engine/
```

Git treats it as a pattern that matches nothing. `src/privacy.ts` strips the `+.` and treats the rest as a gitignore pattern anchored to the repo root. On top of that, `.env*`, `*.pem`, `*.key`, lockfiles, and `node_modules/` are always excluded, even if `.gitignore` tries to un-ignore them.

The Claude skill at `.claude/skills/constellation-context/SKILL.md` teaches Claude Code the same rule.

## Sync

From the repo root:

```
npm run ctx:sync                # send changes since the last sync
npm run ctx:sync -- --dry-run   # show what would be sent
```

What it does:

1. Picks the base commit: `CTX_BASE_SHA` (set by CI), else `.ctx-last-sha`, else `HEAD~1`.
2. Lists changed files, drops excluded and `+.` paths. Private file names are never printed, only counted.
3. Sends up to 30 files, each diff cut to 4000 chars, plus any cards in `.ctx-cards.json`.
4. On success writes `.ctx-last-sha` and deletes `.ctx-cards.json`.

Env: `BACKEND_URL` (default `http://localhost:3000`).

The GitHub Action in `.github/workflows/ctx-sync.yml` runs the same script on every push to main. Set the `BACKEND_URL` repo secret; without it the job skips. Cards only come from local runs, since `.ctx-cards.json` is not committed.

## Mock backend

```
npm run mock     # http://localhost:3001, saves the last payload to mock/out/last-code.json
```

Then point the sync at it. PowerShell: `$env:BACKEND_URL="http://localhost:3001"; npm run ctx:sync`

## Note for Team C: optional `cards` field

`POST /api/ingest/code` gets one optional, backward compatible field. When present, these were written by Claude Code from the change itself and can be used instead of (or to ground) the backend's own extraction:

```ts
type FeatureCard = {
  label: string        // max 40
  summary: string      // max 140, salesperson-readable
  status: 'shipped' | 'in_beta' | 'in_progress'
  paths: string[]      // files the card is about, never private
}
// body: { repo, commitSha, files: { path, diff }[], cards?: FeatureCard[] }
```

Suggested mapping onto `Node`: `type: 'feature'`, `domain: 'engineering'`, `sourceKind: 'code'`, `sourceRef: commitSha`, status `shipped -> done`, `in_beta -> on_track`, `in_progress -> on_track`. Cards do not carry `sellable`, so `Node.sellable` is set on the backend side.

## Demo

1. `npm run mock` in one terminal.
2. Edit `demo/src/features/checkout/index.ts`, commit, run the sync. The mock logs the file and returns a node.
3. Edit only `demo/src/features/secret-pricing-engine/index.ts`, commit, run the sync. It prints "Nothing to sync." and sends nothing.

## Tests

```
npm test
```
