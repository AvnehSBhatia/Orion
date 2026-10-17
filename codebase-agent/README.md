# Orion codebase agent

Sends what changed in a repo to Orion, so the org's context map knows what engineering shipped. Each sync posts the diffs since the last sync, plus any feature cards your coding agent wrote, to `POST /api/ingest/code`. Orion reads them with a model and updates the matching work items.

Paths you mark private never leave the machine, and their names are never printed.

## In a customer's repo (GitHub Actions)

Nothing to install in the repo. An Orion admin opens Settings, Connect GitHub, creates a token for the repo, adds it as the repository secret `ORION_TOKEN`, and commits the workflow it shows as `.github/workflows/orion-sync.yml`. On each push the workflow downloads this agent as one file from the Orion server (`/api/downloads/ctx-sync.mjs`, built by `npm run build` into `dist/` and baked into the server image) and runs it with Node. An admin's token lets Orion credit each commit to its git author; a member's token credits every commit to that member.

## Setup (this repo, or running it by hand)

```sh
cd codebase-agent
npm install
```

Then, from the repo root:

```sh
export BACKEND_URL=https://<your-orion-host>   # default http://localhost:3001
export ORION_TOKEN=...                          # an Orion API token
npm run ctx:sync                # send changes since the last sync
npm run ctx:sync -- --dry-run   # print what would be sent, send nothing
```

Create a token with `POST /api/auth/tokens` or with `npx tsx scripts/account.ts token --username <you> --label ci` in `server/`. The org comes from the token.

| Env | Meaning |
| --- | --- |
| `BACKEND_URL` | Orion server. Default `http://localhost:3001`. |
| `ORION_TOKEN` | API token, sent as `Authorization: Bearer`. Required unless the server runs with `AUTH_DISABLED=true`. |
| `ORION_ORG_ID` | Org to sync into. Only needed without a token; defaults to `demo`. |
| `ORION_USER_ID` | Optional. Without it, Orion matches the commit author's name or email to a person in the org. |
| `CTX_BASE_SHA` | Base commit. Set by CI; locally the last synced commit is used. |

## Private paths: the `+.` rule

In the root `.gitignore`, a line starting with `+.` means "agents must not read or publish this path":

```
+./demo/src/features/secret-pricing-engine/
```

Git treats the line as a pattern that matches nothing, so it has no effect on git. The sync strips the `+.` and treats the rest as a gitignore pattern anchored to the repo root. Files under it are never sent, cards that mention them are dropped, and the log only shows a count.

These are always excluded too, even if `.gitignore` un-ignores them: `.env*`, `*.pem`, `*.key`, lockfiles, `node_modules/`, and the sync's own state files. Anything git already ignores is excluded as well.

The skill at `.agents/skills/orion-context/SKILL.md` teaches coding agents the same rule and how to write feature cards.

## What a sync does

1. Picks the base commit: `CTX_BASE_SHA`, else `.ctx-last-sha` (the last successful sync), else `HEAD~1`.
2. Lists changed files and drops excluded and private ones.
3. Sends up to 30 files, each diff cut to 4000 chars, plus the cards in `.ctx-cards.json`.
4. On success writes `.ctx-last-sha` and deletes `.ctx-cards.json`.

If nothing is left to send, it prints "Nothing to sync." and moves `.ctx-last-sha` forward.

## Feature cards

A coding agent writes `.ctx-cards.json` at the repo root after a user-visible change. Each card is a plain-language summary a salesperson can read:

```ts
type FeatureCard = {
  label: string        // max 40 chars
  summary: string      // max 140 chars
  status: 'shipped' | 'in_beta' | 'in_progress'
  paths: string[]      // files the card is about, never private
}
```

Orion gives cards to the model as the author's description of the change and keeps their wording unless the diff contradicts it. If the model is unavailable, each card becomes a feature node directly (`shipped` becomes done, the others on track). A sync with cards and no files is accepted.

The full request body:

```ts
{ orgId?, repo, commitSha, files: { path, diff }[], cards?: FeatureCard[], userId?, author: { name, email } }
```

## CI

`.github/workflows/ctx-sync.yml` runs the sync on every push to `main`, diffing against the previous push. Set the `BACKEND_URL` and `ORION_TOKEN` repository secrets (`ORION_ORG_ID` only if you do not use a token). Without `BACKEND_URL` the job skips. Cards only come from local runs, since `.ctx-cards.json` is not committed.

## Checking a sync without a server

`mock/server.mjs` is a stand-in for `POST /api/ingest/code`. Use it to see exactly what a sync would send, or to try the private-path rule, without running the Orion server or a model. It validates the body against the server's limits and saves the last payload to `mock/out/last-code.json`.

```sh
npm run mock     # listens on http://localhost:3001
```

Then run `npm run ctx:sync` from the repo root with the default `BACKEND_URL`. To see the private rule work, edit `demo/src/features/checkout/index.ts`, commit, and sync: the file is sent. Then edit only a file under `demo/src/features/secret-pricing-engine/`, commit, and sync: it prints "Nothing to sync." See `demo/README.md`.

## Tests

```sh
npm test
npm run typecheck
```
