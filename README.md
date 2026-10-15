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
| `server/` | Backend (Next.js API). Routes in `server/app/api/**/route.ts`, logic in `server/src/` (`http/`, `auth/`, `orgs/`, `ingest/`, `orgspace/`, `retrieval/`, `digests/`, `dashboard/`, `chat/`, `mcp/`; map in [`server/src/README.md`](server/src/README.md)). Tests next to the code (`*.test.ts`). |
| `web/` | Dashboard UI (Next.js). |
| `extension/` | Chrome extension that captures the tabs, windows, and screens a person picks. |
| `codebase-agent/` | Turns commits into feature cards; respects `+.` private paths in `.gitignore`. Also runs in CI (`.github/workflows/ctx-sync.yml`). |
| `.agents/skills/orion-context/` | Skill that teaches coding agents to pull context and write feature cards. |
| `server/scripts/` | `account.ts` (accounts and tokens), `seed.ts` (demo org), `bench.ts`, `bench-embed.ts`, `eval.ts` (cost and accuracy). |
| `demo/` | Tiny fake product for the codebase agent demo. |
| `mac/` | Constellation Time, the native macOS capture app (Swift). Its backend contract is in [`mac/BACKEND_CONTRACT.md`](mac/BACKEND_CONTRACT.md). |

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

## Deploy

Orion runs on one box: the API, the dashboard, and Caddy for automatic HTTPS. The dashboard is served at `app.<domain>` and the API at `api.<domain>`. Everything for deployment is in `deploy/`:

| Path | What |
|---|---|
| `deploy/docker-compose.yml` | Server, web, and Caddy. Data and models live on volumes. Start with `cp deploy/.env.example deploy/.env`, fill it in, then `docker compose -f deploy/docker-compose.yml up -d --build`. |
| `deploy/setup-ubuntu.sh` | The same setup on a plain Ubuntu VPS without Docker. Installs Node 22, an `orion` user, swap sized by RAM, ufw, unattended-upgrades, Caddy, the systemd units, and the backup timer. |
| `deploy/systemd/` | Units for the server, web, and backup timer, plus `orion-update.sh` for updates and rollbacks. |
| `deploy/backup/orion-backup.sh` | Daily online SQLite backup (`server/scripts/backup.ts`) with an integrity check, local retention, and an offsite copy via rclone (S3, B2, or R2). |

Box size depends on where embeddings run:

- 1 GB: use `EMBED_PROVIDER=openrouter` and swap.
- 2 GB: comfortable with `EMBED_PROVIDER=openrouter`.
- 4 GB: needed to run EmbeddingGemma locally (`EMBED_PROVIDER=gemma`). The model takes about 1 GB once loaded; an image embed peaks near 2 GB more, so use 8 GB if you set `EMBED_SCREENSHOTS=always`. Run `npm run embed-models` in `server/` at deploy time to download it into a persistent `MODEL_CACHE_DIR`.

Run one server process per `DATA_DIR`: retention (hourly) and extraction retries run inside it. Back up with `npm run backup` in `server/` (SQLite's online backup API, safe while the server runs; never `cp` a live database). Monitor `GET /api/health` (503 when a check fails).

Create the first admin with `server/scripts/account.ts` inside the deployment.

Further reading:

- [docs/deploy.md](docs/deploy.md): step-by-step setup.
- [docs/runbook.md](docs/runbook.md): updates and rollback, logs, health, backups and restore, key rotation, deletion requests, incidents.
- [docs/launch-checklist.md](docs/launch-checklist.md): the manual steps before launch.
- [docs/legal/](docs/legal/): the privacy and compliance drafts.

## CI

`.github/workflows/ci.yml` runs on every PR and push:

- server: vitest, `next typegen`, tsc, build
- web: typegen, tsc, eslint, build
- extension: tsc, build
- codebase-agent: tests, tsc
- `npm audit` on production dependencies
- a build of both Docker images

Dependabot opens weekly updates. `ctx-sync.yml` syncs commits to Orion when the `BACKEND_URL`, `ORION_ORG_ID`, and `ORION_TOKEN` secrets are set.

## API

The request and response shapes are in `server/src/contract/types.ts`.
