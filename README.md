# Orion

A live context base for a company. What people do in their tools (a budget change in Google Ads, a ticket, a commit) becomes a shared graph of work. Engineers pull it into their coding agent over MCP, and everyone gets a dashboard they can reshape by typing what they want to see.

```
Chrome extension ──captures──▶ ┐
codebase agent / CI ─commits─▶ ├─▶ backend (Next.js API, :3001) ──▶ SQLite per org (data/orgs/<org>.db)
                               │        │            │
web dashboard (:3000) ◀────────┘        │            └─▶ MCP /api/mcp ──▶ Claude Code, Cursor, Codex
                                        └─▶ OpenRouter (extraction, chat), EmbeddingGemma 2 in process
```

## Layout

| Path | What it is |
|---|---|
| `server/` | Backend (Next.js API). Routes in `server/app/api/**/route.ts`, logic in `server/src/` (ingest, graph, steering, digests, MCP, auth). Tests next to the code (`*.test.ts`). |
| `web/` | Dashboard UI (Next.js). |
| `extension/` | Chrome extension that captures the tabs, windows, and screens a person picks. |
| `codebase-agent/` | Turns commits into feature cards; respects `+.` private paths in `.gitignore`. Also runs in CI (`.github/workflows/ctx-sync.yml`). |
| `.agents/skills/orion-context/` | Skill that teaches coding agents to pull context and write feature cards. |
| `server/scripts/` | `account.ts` (accounts and tokens), `seed.ts` (demo org), `bench.ts`, `bench-embed.ts`, `eval.ts` (cost and accuracy). |
| `demo/` | Tiny fake product for the codebase agent demo. |

## Run it locally

```sh
cd server && npm install && cp .env.example .env   # set OPENROUTER_API_KEY
npm run dev                                        # backend on :3001
cd web && npm install && npm run dev   # dashboard on :3000
cd extension && npm install && npm run build   # load extension/dist unpacked in chrome://extensions
```

In `server/`: `npm test` runs the backend suite, `npm run bench` measures server CPU on a copy of an org file, `npm run bench:embed` the embedder, `npm run eval` retrieval accuracy. `npm run typecheck` at the root checks every package.

## Cost controls

Set in `server/.env` (see `server/.env.example`):

- `EMBED_SCREENSHOTS=auto` embeds a screenshot only when the capture has little text (desktop windows, screens). An image embed costs ~14x a text embed on CPU.
- `MAINTAIN_INTERVAL_MS=60000` is the minimum time between org maintenance runs.
- `EMBED_PROVIDER=gemma` runs embeddings on the server CPU; `openrouter` moves them to an API (re-embeds the org once on switch).
- `INGEST_IMAGES=light` (default) skips OCR and screenshot pruning.

## Accounts and tokens

Every API route needs a sign-in (set `AUTH_DISABLED=true` in `server/.env` for a local demo).

```sh
cd server
npx tsx scripts/account.ts create --username mina --password '...' --org acme --user mina --admin
npx tsx scripts/account.ts token --username mina --label "claude code"   # API token for MCP, the extension, or CI
```

The web app shows a sign-in screen; the extension signs in from its options page and keeps an API token; the codebase agent and CI send `ORION_TOKEN`.

## MCP for coding agents

```sh
claude mcp add --transport http orion https://<host>/api/mcp --header "Authorization: Bearer $ORION_TOKEN"
```

`context_for_task` returns one markdown context file for the task at hand (relevant work, what changed recently and who changed it, key documents, blockers, next steps). The `orion-context` skill tells the agent to call it at the start of a task and save it to `.orion/context.md`. Full tool list: [docs/mcp.md](docs/mcp.md).

## Deploy on one box

1. `npm ci && npm run build` in `server/` and in `web/` (set `NEXT_PUBLIC_ORION_API` to the backend URL before building the web app).
2. `server/.env`: `OPENROUTER_API_KEY`, `COOKIE_SECURE=true`, `UI_ORIGIN=https://<web host>`, `TRUST_PROXY=true` behind a proxy, `EXTENSION_IDS`.
3. Run `npm start` in `server/` (backend, :3001) and `cd web && npm start` (:3000) under a process manager, behind HTTPS. UI and API must be on the same site for the session cookie (for example app.example.com and api.example.com).
4. Create the first admin with `server/scripts/account.ts`, then load the extension and sign in.

Data lives in `server/data` (`DATA_DIR`) (SQLite per org plus `auth.db`). Back it up with `npm run backup` in `server/` (SQLite's online backup API, safe while the server runs; never `cp` a live database), for example hourly from cron or a systemd timer, and ship `BACKUP_DIR` off the box. The script keeps the newest `BACKUP_KEEP` copies and exits 1 if any database failed.

Box sizing: with `EMBED_PROVIDER=gemma` (default) the embedding model runs in the API process. Run `npm run embed-models` in `server/` at deploy time to download it (~520MB) into a persistent `MODEL_CACHE_DIR`. It takes about 1GB of memory once loaded and an image embed peaks near 2GB, so use at least 4 vCPU / 8GB and a process manager that restarts on OOM. Run one `next start` process per `DATA_DIR`: retention (hourly) and extraction retries run inside it. Monitor `GET /api/health` (503 when a check fails).

## API

The request and response shapes are in `server/src/contract/types.ts`.
