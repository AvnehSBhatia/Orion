# API additions for production

The contract the server, web, and extension build against. Existing endpoints are in `server/src/contract/types.ts`; these are new or changed. All JSON, all errors `{ error }`. "admin" means the caller's account is an admin of the org; every route is scoped to the caller's org.

## Health

- `GET /api/health` (public) → `200 { ok: true, version, checks: { orgsDir, authDb, embedder: "ready" | "loading" | "error", llmKey: boolean } }`, or `503` with the same shape when a check fails.

## Session and consent

- `GET /api/auth/me` → adds `email: string | null`, `consent: { required: boolean, version: number, acceptedAt: string | null }`.
- `POST /api/auth/consent { version }` → `{ acceptedAt }`. Capture endpoints answer `403 { error: "consent required" }` until the caller accepted the org's current `consentVersion`.
- `POST /api/auth/password { current, next }` → `204`; signs out the account's other sessions.

## Accounts, invites, resets (admin unless noted)

- `GET /api/auth/accounts` → `{ accounts: [{ username, userId, name, email, admin, disabled, createdAt, lastSeenAt, consentAt }] }`
- `PATCH /api/auth/accounts/:username { admin?, disabled?, email? }` → `{ account }`. Disabling revokes every session and token. An admin cannot disable or demote themselves if they are the last admin.
- `POST /api/auth/accounts/:username/reset` → `{ resetUrl, expiresAt }` (one-time, 24h). The admin shares the link.
- `POST /api/auth/reset { token, password }` (public) → `204`.
- `POST /api/auth/invites { admin?: boolean, role?: string }` → `{ id, inviteUrl, expiresAt }` (7 days, one use).
- `GET /api/auth/invites` → `{ invites: [{ id, admin, role, createdBy, createdAt, expiresAt, usedBy }] }`; `DELETE /api/auth/invites/:id` → `204`.
- `GET /api/auth/invites/:token` (public) → `{ orgName, expiresAt }` or 404.
- `POST /api/auth/accept-invite { token, username, password, name, role, email? }` (public) → same body and cookie as login.

Links point at the web app: `${UI_ORIGIN}/invite/<token>` and `${UI_ORIGIN}/reset/<token>`.

## API tokens (existing, for reference)

- `GET /api/auth/tokens`, `POST /api/auth/tokens { label }` → `{ id, token, label }` (shown once), `DELETE /api/auth/tokens/:id`.

## Org settings and usage (admin)

- `GET /api/orgs/:orgId/settings` → `{ settings: OrgSettings }` (see `server/src/orgs/settings.ts`; members may read it).
- `PATCH /api/orgs/:orgId/settings { ...partial OrgSettings }` → `{ settings }`.
- `GET /api/orgs/:orgId/usage` → `{ month: "2026-10", llm: { calls, inputTokens, outputTokens, costUsd, budgetUsd }, captures: { month, total }, storage: { bytes, screenshotsBytes } }`.
- `GET /api/audit?limit=100` → `{ events: [{ at, actor, action, target, detail }] }`. Actions: login, login_failed, logout, token_created, token_revoked, account_created, account_updated, password_changed, password_reset, invite_created, invite_accepted, settings_changed, data_deleted.

## Capture policy (any signed-in caller, used by the extension)

- `GET /api/capture/policy` → `{ captureEnabled, excludedHosts, captureIntervalSec, consent: { required, version } }`. The extension polls it every few minutes and on start.

## Data deletion

- `DELETE /api/me/captures` → `{ deleted }` removes the caller's own captured documents and screenshots.
- `DELETE /api/users/:userId` (admin) → `{ deleted }` removes the person, their captures, and their account.
- `DELETE /api/orgs/:orgId { confirm: "<orgId>" }` (admin) → `204` removes the org file and its accounts.

## Changed behavior

- `GET /api/sources/:id/image`: `403` unless the caller is the author, an admin, or the org sets `screenshotVisibility: "org"`.
- `GET /api/sources/:id`: text stays org-wide; `hasImage` is false for callers who may not see the screenshot.
- `POST /api/ingest/code`: `userId` must be the caller unless admin (attribution by git author still works for admins and CI tokens created by admins).
- Picking another person ("viewing as") is admin-only on every route that takes `userId`.
- Cookie-authenticated writes need `Content-Type: application/json` and an `Origin` in `UI_ORIGIN`; Bearer requests are exempt.
- Over-limit requests answer `429 { error, retryAfterSec }` with a `Retry-After` header; over-budget model steps answer `402 { error: "monthly model budget reached" }` for chat and dashboard asks, and ingest stores the document without extraction.
