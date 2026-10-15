# server/src

Everything the API does lives here. Route files in `server/app/api/**/route.ts` stay thin: they parse input, check who is calling, and call one function from this folder. Tests sit next to the code (`*.test.ts`); `npx vitest run` runs them.

## Folder map

| Folder | What it holds |
|---|---|
| `contract/` | The API shapes (`types.ts`, copied by the web app and extension) and their zod schemas (`schemas.ts`). |
| `http/` | `route()` (sign-in, body cap, rate limit, CSRF, security headers, request log, JSON errors), `deps.ts` (per-org store handles and shared clients), `stream.ts` (SSE and NDJSON responses), `configCheck.ts` (boot-time config validation), and `routes.authz.test.ts` (authorization for every route). |
| `auth/` | `auth.db`: accounts, sessions and API tokens, invites, reset links, consent; login, password change and reset, admin account management, signup. |
| `audit/` | The audit log (in `auth.db`) and the actions it records. |
| `orgs/` | Org settings (`settings.ts`), the capture policy and gate, screenshot visibility, the org profile, people, and data deletion. |
| `usage/` | Model spend per org per month and the monthly budget (`withUsage`, `assertBudget`). |
| `db/store/` | The per-org SQLite store: one file per org, one module per table group. `db/seed.ts` builds the demo org. |
| `ingest/` | Turning a capture or a commit into a stored document and graph changes (`pipeline.ts`), page diffs, screenshot handling, extraction retries. |
| `llm/` | The model clients: OpenRouter chat with timeouts and retries, extraction prompts, embedders (EmbeddingGemma in process, OpenRouter, or a local hashing one for tests). |
| `graph/` | Reading the graph as people see it: ripple of blocked work, gaps, the 3D projection. |
| `orgspace/` | The org's learned map: embeddings, a compressor trained per org, area labels, clusters, each person's gravity, and the maintenance loop that keeps them fresh. |
| `retrieval/` | Ranking work for a person and a question: context, feed, brief, activity, filters. |
| `digests/` | Merging many similar documents into one short digest. |
| `dashboard/` | Each person's dashboard: composed from their role, reshaped by asking, saved. |
| `chat/` | The built-in assistant: context up front, one model call, citations, actions. |
| `mcp/` | The MCP server for coding agents (`context_for_task` and friends). |
| `retention/`, `jobs/`, `health/` | Retention purges, background job scheduling and backups, and `/api/health`. |
| `lib/`, `test/`, `eval/` | Small helpers, test fixtures, and the retrieval accuracy eval. |

## Life of a capture

1. The extension posts a tab, window, or screen to `POST /api/ingest/capture` with an API token.
2. `route()` gives it a request id, refuses a body over 4MB (413), spends a token from the caller's ingest bucket (429 when empty), and resolves the token to an account (401 for unknown, expired, or disabled ones).
3. The route pins `orgId` and `userId` to the caller (posting as someone else takes an admin), then `orgs/policy.ts` `captureGate` applies the org's rules: 403 while capture is paused, 403 `consent required` until the person accepted the current monitoring notice, and `{ skipped: "excluded" }` for an excluded host, with nothing stored.
4. `ingest/pipeline.ts` `ingestCapture` checks the same settings again, strips the URL's query string, turns the HTML into text, shrinks the screenshot, and answers a repeat of the person's last capture from it.
5. Inside `withUsage` (so the model call is billed to the org and stopped by its budget), the extractor reads the page with what changed since last time and returns graph updates. A page with no work in it is not stored.
6. `applyUpdate` saves the document, its screenshot, and what it changed (`source_changes`), merges the nodes and edges, and records the person's touches. A failed extraction keeps the document and queues a retry.
7. Embeddings, the org map, clusters, and digests catch up in the background (`orgspace/maintain.ts`), and the request log line goes out.

## Life of a question

1. The web app posts to `POST /api/chat?stream=1` with the session cookie. `route()` checks the Origin and JSON content type (CSRF), the ask bucket, and the session.
2. The route checks the org's model budget (402 when spent) and runs the rest inside `withUsage`.
3. `chat/answer.ts` retrieves context: `retrieval/context.ts` ranks work items and documents for this person and question, using embeddings and the person's gravity in the org map. If the embedder is slow, a lexical pick (`quickContext`) stands in after 1.2s.
4. One model call (`chat/model.ts`) writes the answer from that context, streaming deltas as server-sent events (`http/stream.ts`), and citations are checked against known ids. Unless the caller skips it, the dashboard fast path runs alongside, so "focus my dashboard on blocked work" also reshapes the dashboard.
5. The `done` event carries the full answer, citations, actions, and any new dashboard. Coding agents ask the same store through MCP instead (`mcp/server.ts`, `context_for_task`).
