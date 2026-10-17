# API additions for production

The contract the server, web, and extension build against. Existing endpoints are in `server/src/contract/types.ts`; these are new or changed. All JSON, all errors `{ error }`. "admin" means the caller's account is an admin of the org; every route is scoped to the caller's org.

## Health

- `GET /api/health` (public) → `200 { ok: true, version, checks: { orgsDir, authDb, embedder: "ready" | "loading" | "error", llmKey: boolean } }`, or `503` with the same shape when a check fails.

## Session and consent

- `GET /api/auth/me` → adds `email: string | null`, `consent: { required: boolean, version: number, acceptedAt: string | null, notice: string }`. `notice` is the monitoring notice (markdown) to show at consent: `docs/legal/monitoring-notice.md` or `docs/legal/employee-monitoring-notice.md` when deployed (DRAFT banner stripped), else a short built-in text. `acceptedAt` is null until the current version is accepted.
- `POST /api/auth/consent` answers `409` when `version` is not the org's current `consentVersion`.
- `POST /api/auth/consent { version }` → `{ acceptedAt }`. Capture endpoints answer `403 { error: "consent required" }` until the caller accepted the org's current `consentVersion`.
- `POST /api/auth/password { current, next }` → `204`; signs out the account's other sessions.

## Accounts, invites, resets (admin unless noted)

- `GET /api/auth/accounts` → `{ accounts: [{ username, userId, name, email, admin, disabled, createdAt, lastSeenAt, consentAt }] }`
- `PATCH /api/auth/accounts/:username { admin?, disabled?, email? }` → `{ account }`. Disabling revokes every session and token. An admin cannot disable or demote themselves if they are the last admin. `409` when another account already uses the email (emails are unique, any case).
- `POST /api/auth/login { username, password }`: `username` takes the account's email too (any case).
- `POST /api/auth/accounts/:username/reset` → `{ resetUrl, expiresAt }` (one-time, 24h). The admin copies the link.
- `POST /api/auth/reset { token, password }` (public) → `204`.
- `POST /api/auth/invites { admin?: boolean, role?: string, email?: string, name?: string }` → `{ id, inviteUrl, expiresAt }` (7 days, one use). Nothing is emailed; the admin copies the link. `409` when an account already uses the email.
- `GET /api/auth/invites` → `{ invites: [{ id, admin, role, email, name, createdBy, createdAt, expiresAt, usedBy }] }`; `DELETE /api/auth/invites/:id` → `204`.
- `GET /api/auth/invites/:token` (public) → `{ orgName, expiresAt, email, name }` or 404.
- `POST /api/auth/accept-invite { token, username, password, name, role, email? }` (public) → same body and cookie as login. `email` defaults to the one the invite was sent to.

Links point at the web app: `${UI_ORIGIN}/invite/<token>` and `${UI_ORIGIN}/reset/<token>`.

## API tokens (existing, for reference)

- `GET /api/auth/tokens`, `POST /api/auth/tokens { label }` → `{ id, token, label }` (shown once), `DELETE /api/auth/tokens/:id`.

## Org settings and usage (admin)

- `GET /api/orgs/:orgId/settings` → `{ settings: OrgSettings }` (see `server/src/orgs/settings.ts`; members may read it).
- `PATCH /api/orgs/:orgId/settings { ...partial OrgSettings }` → `{ settings }`.
- `GET /api/orgs/:orgId/usage` → `{ month: "2026-10", llm: { calls, inputTokens, outputTokens, costUsd, budgetUsd }, captures: { month, total }, storage: { bytes, screenshotsBytes } }`.
- `GET /api/audit?limit=100` → `{ events: [{ at, actor, action, target, detail }] }`. Actions: login, login_failed, logout, token_created, token_revoked, account_created, account_updated, password_changed, password_reset, invite_created, invite_accepted, settings_changed, data_deleted, viewed_as (an admin read another person's feed, brief, context or dashboard; once an hour per admin and person), source_opened (another person's Mac text or screenshot; once an hour per viewer and document), org_updated (changed field names), mcp_tool_called (tool name and call count; once a minute per token and tool), data_exported, audit_exported, and the Mac events. Details hold ids and counts, never captured text or titles. Events are kept 400 days.
- `GET /api/audit?format=csv` (admin) → every event the org keeps, oldest first, as `orion-audit-<org>-<date>.csv`.

## Capture policy (any signed-in caller, used by the extension)

- `GET /api/capture/policy` → `{ captureEnabled, excludedHosts, captureIntervalSec, consent: { required, version } }`. The extension polls it every few minutes and on start.

## Data export (access requests)

- `GET /api/me/export` → the caller's data as `orion-export-<user>-<date>.json`: accounts (no password hash), person, documents they authored with text and what each changed, Mac work blocks, time entries, drafts, baseline and alias rules, work items they own, touched or changed, token metadata (no hashes), their dashboard, and audit events where they acted or were acted on. Screenshots are listed as a count and ids; each downloads from `GET /api/sources/<id>/image`.
- `GET /api/users/:userId/export` (admin, same org) → the same file for one person. Both are audited as `data_exported`.

## Data deletion

- `DELETE /api/me/captures` → `{ deleted }` removes the caller's own captured documents and screenshots.
- `DELETE /api/users/:userId` (admin) → `{ deleted }` removes the person, their captures, and their account.
- `DELETE /api/orgs/:orgId { confirm: "<orgId>" }` (admin) → `204` removes the org file and its accounts.

## Changed behavior

- `GET /api/sources/:id/image`: `403` unless the caller is the author, an admin, or the org sets `screenshotVisibility: "org"`.
- `GET /api/sources/:id`: text stays org-wide except `kind: "mac"` sources, which are `403` for anyone but the author and admins (see "Who sees what" in mac-v1.md); `hasImage` is false for callers who may not see the screenshot.
- `POST /api/ingest/code`: `userId` must be the caller unless admin (attribution by git author still works for admins and CI tokens created by admins).
- Picking another person ("viewing as") is admin-only on every route that takes `userId`.
- Cookie-authenticated writes (POST, PATCH, DELETE) need an `Origin` in `UI_ORIGIN` (or, when the browser sends no Origin, `Sec-Fetch-Site: same-origin | same-site`), else `403`; a body with any `Content-Type` other than JSON answers `415`. A bodyless write may omit `Content-Type`. Bearer requests are exempt.
- Bodies over 256KB (4MB for `/api/ingest/capture`, 1MB for `/api/ingest/code`) answer `413` before parsing.
- Every API response carries `X-Request-Id` (echoes a valid incoming one) and security headers.
- Behind HTTPS (`COOKIE_SECURE=true`) the session cookie is `__Host-orion_session`; the old `orion_session` name is still accepted.
- Over-limit requests answer `429 { error, retryAfterSec }` with a `Retry-After` header; over-budget model steps answer `402 { error: "monthly model budget reached" }` for chat and dashboard asks, and ingest stores the document without extraction.
