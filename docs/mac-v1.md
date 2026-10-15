# Mac app ↔ Orion server: the /v1 contract

The Mac app (`mac/Constellation`) talks to the Orion server (`server/`) through `/v1`. The base is the team spec, `openapi/v1.yaml` from the `cursor/constellation-time-b1-b5-ab25` branch, with the fixes from the backend review and a few Orion additions. Where this file and that spec differ, this file wins, and `openapi/v1.yaml` in this repo is updated to match.

All JSON. Errors are `{ "error": { "code": "...", "message": "..." } }` on `/v1` (Orion's `/api` keeps `{ error }`). Times are ISO 8601 UTC. Device calls send `Authorization: Bearer <device_token>`. HTTPS only, except `http://localhost` for development.

## Decisions taken

- **A. Client sync cursor:** `etag`. The app stores the last `etag` and sends it as `since`; the server returns the full list when `since` is missing, unknown, or the list is empty on the device.
- **B. match_confidence:** stored and shown, not used to flag yet. The app sends `min(score, 100) / 100`, and `0` with `match_method: "none"` when nothing matched.
- **C. Finalize:** the employee finalizes with "Done for Today" in Today's Draft (`POST /v1/drafts/{id}/finalize`, then the CSV from `/v1/drafts/{id}/export`). Admins can also export firm-wide.
- **D. Outbox summaries:** kept. The server calls the model through OpenRouter with zero-data-retention routing (`provider: { zdr: true, data_collection: "deny" }`), stores nothing and logs nothing from the request. Written confirmation of zero retention from the provider is still a launch item (`docs/launch-checklist.md`).
- **No screenshots.** The Mac app reads on-screen text through the Accessibility API (window titles and visible text, Mail's open email, browser tab titles and domain plus path) and never takes screenshots or records the screen. **Browser page text** is an Orion addition: off by default, turned on only by an org admin (`/v1/policy`) and then by the person on their Mac; it goes through the same redaction and link cutting.

## Device registration

`POST /v1/devices/register { name, auth_code }` → `200 { device_id, device_token }`. `401` when the code is invalid, used, or expired.

- `name` is the Mac model ("MacBook Pro") or "Mac", never the computer or user name.
- `auth_code`: a one-time code the person makes in the web app (Settings → Connect your Mac), valid 15 minutes, 8 characters like `K7QF-2M9D` (letters and digits without 0/O/1/I; dash optional, case-insensitive).
- The device token belongs to that person and works only on `/v1` (and `GET /api/health`). Revoking it in Settings (it is listed with the device name) disconnects the Mac.
- Rate limited like login.

## Policy and consent (Orion additions)

`GET /v1/policy` → `200`

```json
{
  "capture_enabled": true,
  "excluded_hosts": ["mail.google.com"],
  "capture_interval_sec": 5,
  "browser_page_text": false,
  "consent": { "required": true, "version": 1, "notice": "markdown of the org's monitoring notice" }
}
```

The app polls it on connect and every 5 minutes. `capture_enabled: false` stops capture (the menu bar shows "Paused by your company"). `excluded_hosts` are added to the person's own skip list (domain and subdomains). `capture_interval_sec` is the minimum gap between content-change reads of one window. Until consent is accepted the app shows the notice and sends no work blocks (it keeps capturing into the Outbox only if the person also chose to; the default is not to capture before consent).

`POST /v1/consent { version }` → `200 { accepted_at }`; `409` if `version` is not current. `/v1/work-blocks` answers `403 { error: { code: "consent_required" } }` until accepted.

## Clients

`GET /v1/clients?since=<etag>` → `200 { clients: Client[], rules: AliasRule[], etag }`.

- `Client`: `{ id, name, aliases, domains, project_codes, active }`. Inactive clients are kept in the list so the device can drop them from matching.
- `AliasRule`: `{ id, pattern, client_id }`. Org-wide rules plus the caller's own rules (made by changing a draft entry's client). A rule matches as a strong signal: a page domain equal to the pattern, or a title containing it (case-insensitive).
- Admin side (web Admin → Clients, and the API): `GET/POST /v1/owner/clients`, `PATCH /v1/owner/clients/{id}`, `POST /v1/owner/clients/import` (CSV: `name,aliases,domains,project_codes`, `;` inside a cell), `GET /v1/owner/alias-rules`, `POST /v1/owner/alias-rules/{id}/accept`. "Owner" is an Orion org admin (session cookie or an admin's API token).

## Work blocks

`POST /v1/work-blocks { batch_hash, blocks }`, up to 500 blocks, idempotent on `local_id`.

Block: `{ local_id, started_at, ended_at, app_bundle_id, app_name, window_title, domain_path, matched_client_id, match_method, match_confidence, snippet, text_hash, redaction_count }`

- `batch_hash`: SHA-256 hex of the sorted `local_id`s joined by `\n`.
- `snippet`: the redacted record text cut to 1,500 characters. `text_hash`: SHA-256 hex of the full local text.
- `match_method`: `domain`, `code`, `alias` (strongest signal), `manual` (the person changed the client), or `none`.
- Request body cap 8 MB.

Response `200`:

```json
{ "accepted": 2, "duplicate": 1, "accepted_ids": ["…", "…", "…"], "rejected": [{ "local_id": "…", "reason": "card_number" }] }
```

- `accepted_ids` lists every id now stored, new or duplicate; the app marks exactly those as sent.
- A block is **rejected on its own**, never the whole batch: `card_number` or `api_key` found in the snippet or title (server guard; emails are allowed because the person may turn email redaction off), `ended_before_started`, `excluded_host`, `invalid`. Rejected blocks stay approved on the Mac; the app stops retrying a block after it was rejected 3 times for the same reason and shows it in the Outbox as "Not accepted by the server: <reason>".
- `403 consent_required`, `403 capture_paused`, `401` as everywhere, `429` with `Retry-After`.
- Each stored block becomes an Orion document (the dashboard, graph, search and MCP see it); model extraction runs in the background.

## Outbox summaries

`POST /v1/summaries { blocks }` (blocks in the work-block shape) → `200 { summary }`: one to three sentences, second person, past tense ("You read Apple's sign-in alert, then checked Initech's pricing page."), markers like `[PHONE]` kept as is, under 600 characters. Nothing is stored or logged. Without a model key, or over the monthly budget, it returns a plain list of titles.

## Today's draft

`GET /v1/drafts/today?tz=America/Los_Angeles` → `200 { draft_id, day, entries }`. "Today" is the local day in `tz` (UTC if missing or invalid), and blocks are picked by their local start time.

Entry: `{ id, client_id, started_at, ended_at, minutes, narrative, evidence: [{ work_block_id, quote }], unmatched, status }`, `status` one of `proposed`, `accepted`, `edited`, `rejected`.

- One entry per client per day, plus one `unmatched: true` entry for blocks with no client.
- `minutes` is the blocks' covered time rounded **up** to the org's billing increment (`billingIncrementMin`, 6 or 15, default 6).
- `narrative`: one line written by the model from the evidence only (quotes taken verbatim from snippets; a narrative that mentions text not in the evidence is replaced by the stub "Work on <client>: <n> items"). Same zero-retention routing and budget as summaries.
- `evidence.work_block_id` is the block's `local_id`, so the Mac can show the items behind an entry.

`POST /v1/drafts/entries/{id}/review { action, minutes?, client_id?, narrative?, started_at?, ended_at? }` → `200 { entry }`. `action`: `accept`, `edit`, `reject`. `client_id: null` means no client. Changing the client creates a personal alias rule from the strongest title or domain in the entry's blocks. Reviewing again replaces the earlier decision.

`POST /v1/drafts/{id}/finalize` → `200 { exported }`. `GET /v1/drafts/{id}/export` → `text/csv` (`date,client,minutes,narrative,status`; no snippets), `409` before finalize.

## Baseline and metrics

`POST /v1/baseline { day, entries: [{ client_id, minutes }] }` → `200 { day, entries }` (replaces that day). `GET /v1/me/metrics?from&to` → as in the spec.

Admin: `GET /v1/owner/export.csv?from&to` (accepted and edited entries for everyone: `date,person,client,minutes,narrative,status`), `GET /v1/owner/pilot?from&to` → `{ people: [{ user_id, name, accepted, edited, rejected, active_days }] }` with no snippets or titles.

## Deletion and retention

`DELETE /v1/me/data` → `202 { request_id }`; the person's work blocks, drafts, entries, baseline, and the Orion documents made from their blocks are removed right away (the 24 h in the spec is the upper bound).

Snippets and evidence quotes are cleared after `snippetRetentionDays` (org setting, default 14); times, clients, minutes and narratives stay until `retentionDays`.

## Org settings added

`billingIncrementMin` (6 | 15, default 6), `snippetRetentionDays` (default 14), `macBrowserPageText` (default false). Shown in web Admin → Capture policy.

## Who sees what

The raw text of a Mac work block (an Orion document with `kind = "mac"`: window text, Mail bodies, window titles) is visible only to its author and org admins. Other members get `403` from `GET /api/sources/:id` and MCP `read_document`, never see it in search, context, feed, chat, briefs or `context_for_task` (filtered before it reaches the model), and see it in activity only as "Mac activity: <app>" metadata. Work items, statuses and summaries extracted from it stay org-wide; with auth off nothing is hidden.
