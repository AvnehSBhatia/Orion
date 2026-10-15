# Constellation backend contract (Mac app side)

Request and response shapes the Mac app uses. The endpoint list comes from the team plan; the bodies below are what the app sends and expects today. `mac/mock-backend/server.mjs` implements them and is the reference if anything here is unclear.

All bodies are JSON. Times are ISO 8601 in UTC (`2026-10-12T17:02:11Z`). Keys are snake_case.

## Auth

`POST /v1/devices/register` returns a device token. Every other call sends it as `Authorization: Bearer <token>`. A `401` or `403` makes the app forget the token and ask the person to connect again.

The app accepts only `https` base URLs, except `http://localhost` for testing.

## Rules the backend can rely on

- **Everything is redacted on the device before it is sent.** Always: card numbers, SSNs, and API keys and tokens arrive as `[CARD]`, `[SSN]`, `[SECRET]`. By default, also email addresses, phone numbers, and street addresses as `[EMAIL]`, `[PHONE]`, `[ADDRESS]`; **the person can turn each of these off**, so real addresses and numbers may arrive. Email addresses can also arrive as `[EMAIL]@acme.com` if the person chose to keep the company part. Optionally private IPs arrive as `[IP]`, and people's names as `[Person 1]`, `[Person 2]` (stable within a session). There is no company-wide override of these choices.
- **Links in text are cut to domain and path** (no query string or fragment).
- **Only blocks the person approved are sent to `/v1/work-blocks`** (or auto approved, by their choice). Blocks still waiting for approval are sent only to `POST /v1/summaries`, which must not keep them.
- **Browsers send no page text.** For browsers, `text` is empty, and `domain_path` is the domain plus path with no query string or fragment.
- **No screenshots, ever.**

## POST /v1/devices/register

Sent once, when the person clicks Connect. No computer name or user name is sent.

Request:

```json
{
  "install_id": "8F6C1E2A-5B7D-4C3E-9A1F-2D4E6B8C0A13",
  "platform": "macOS",
  "os_version": "Version 15.7.7 (Build 24G720)",
  "app_version": "0.6.0-dev",
  "enrollment_code": "ACME-4821"
}
```

- `install_id`: random UUID, stable for this install. Registering again from the same install may return the same device.
- `enrollment_code`: optional. The person types it if the company gives one; the backend can use it to know which company and person this device belongs to. Omitted when empty.

Response `200`:

```json
{ "device_id": "dev_3f9a1c2e", "token": "6c1b...e9" }
```

The app keeps both in the macOS Keychain.

## POST /v1/work-blocks

Approved blocks, up to 50 per request, oldest first. Sent within about a minute of approval, retried with backoff (30 s, doubling, capped at 15 min) if the backend can't be reached.

Request:

```json
{
  "device_id": "dev_3f9a1c2e",
  "blocks": [
    {
      "id": "0B2D6C1E-7A4F-4E21-8D3B-5C9A1F2E6B70",
      "started_at": "2026-10-12T17:02:11Z",
      "ended_at": "2026-10-12T17:14:40Z",
      "app_bundle_id": "com.apple.mail",
      "app_name": "Mail",
      "window_title": "Re: Acme renewal",
      "domain_path": null,
      "text": "Hi [Person 1], the renewal draft is attached. Call me at [PHONE].",
      "redaction_count": 2,
      "client_id": null
    }
  ]
}
```

| Field | Notes |
|---|---|
| `id` | UUID made on the device. **Resends happen** (timeouts, retries): treat the same `id` as the same block and keep one copy. |
| `started_at`, `ended_at` | One stretch of work in one app and window. |
| `app_bundle_id`, `app_name` | The app, e.g. `com.apple.mail` / `Mail`. |
| `window_title` | Redacted. For browsers, the tab title. |
| `domain_path` | Browsers only, e.g. `docs.google.com/document/d/[SECRET]/edit`. `null` otherwise. |
| `text` | Redacted text from the window, up to 4,000 characters. Empty for browsers. May have been edited by the person before sending. |
| `redaction_count` | How many markers the block contains. |
| `client_id` | From on-device client matching against `GET /v1/clients`. `null` when no client clearly matched. |

No other fields are sent.

Response `200`:

```json
{
  "accepted": ["0B2D6C1E-7A4F-4E21-8D3B-5C9A1F2E6B70"],
  "rejected": [{ "id": "…", "reason": "ended_at before started_at" }]
}
```

The app marks only `accepted` ids as sent, and shows the time and destination in the person's Outbox. Rejected blocks stay approved and are tried again, so reject only for problems a retry can fix, or the app keeps resending. `rejected` may be omitted.

## POST /v1/summaries

**The AI summary the person reads in their Outbox.** The app groups work into batches (one stretch of capturing; a gap of more than 5 minutes starts a new one) and, while a batch waits for approval, posts its blocks here and shows the returned summary at the top of the batch. The person approves or deletes based on it.

Sent a few seconds after a batch changes (a new block, an edit, a delete), so the same batch can arrive several times as it grows; summarize the whole batch each time. Also sent for the most recent sent batches.

**Must not store anything.** These blocks are not approved yet: do not save them, the summary, or the text in logs, databases, or AI provider training data. Only `/v1/work-blocks` is for keeping.

Request (the blocks are exactly what `/v1/work-blocks` would get, same fields and redaction):

```json
{
  "device_id": "dev_3f9a1c2e",
  "blocks": [
    { "id": "0B2D…", "started_at": "2026-10-12T17:02:11Z", "ended_at": "2026-10-12T17:14:40Z",
      "app_bundle_id": "com.apple.mail", "app_name": "Mail",
      "window_title": "Re: Acme renewal — Jane Doe", "domain_path": null,
      "text": "Hi [Person 1], the renewal draft is attached. Call me at [PHONE].",
      "redaction_count": 2, "client_id": "c_acme" }
  ]
}
```

Response `200`:

```json
{ "summary": "Replied to Jane Doe about the Acme renewal: sent the updated draft and moved the start date to November." }
```

- `summary`: plain text, a few sentences, past tense, about what the person did. Shown as is; keep markers like `[PHONE]` rather than guessing what they hide. Aim for under 600 characters.
- Mail window titles are `Subject — Sender`. Browser blocks have only `window_title` and `domain_path`, no text.
- Errors: `401`/`403` as everywhere; anything else shows "Couldn't get a summary" and the app tries again after a minute.

The mock is a working reference: with `ANTHROPIC_API_KEY` set it asks Claude (`claude-opus-5-5`, or `CLAUDE_MODEL`) with the prompt in `mock-backend/server.mjs` (`SUMMARY_PROMPT`), in the second person ("You read Apple's sign-in alert…"); without a key it returns a plain list of titles.

## GET /v1/clients?since=

The client list, for matching work blocks to clients **on the device**. Fetched when the person connects and then every 15 minutes, with `since` set to the last `next_since` (omitted on the first call).

Response `200`:

```json
{
  "clients": [
    {
      "id": "c_acme",
      "name": "Acme Corp",
      "aliases": ["Acme", "ACME Inc"],
      "domains": ["acme.com", "acme.atlassian.net"],
      "project_codes": ["ACM-", "P-1042"],
      "updated_at": "2026-10-01T09:00:00Z",
      "deleted": false
    }
  ],
  "next_since": "2026-10-12T18:00:00Z"
}
```

- With `since`, return only clients created, changed, or deleted after it. A client with the same `id` replaces the device's copy; `"deleted": true` removes it. Returning the full list every time also works.
- `aliases`, `domains`, `project_codes`, `updated_at`, and `deleted` are optional.
- `domains` match the domain and its subdomains (`acme.com` matches `app.acme.com`).
- A project code ending in `-` is a prefix (`ACM-` matches `ACM-12`); otherwise it must match exactly (`P-1042`).
- Names and aliases match as whole words, ignoring case; names under 3 characters are ignored.

How the device matches (so the backend knows what `client_id` means): it scores each client against the block's browser page domain, window title, browser path, and text. Domain of the browser page is the strongest signal, then a project code or name in the title, then signals in the text. It sends a `client_id` only if one client clearly wins; a tie, or only weak signals such as a name mentioned once in body text, sends `null`. Email addresses are redacted before matching, so email domains don't count. The client list is stored encrypted on the device, and client names are exempt from the optional name masking.

## GET /v1/drafts/today?tz=

The person's time entries for today, drafted by the backend from the work blocks it received (summaries are the backend's job). `tz` is the Mac's IANA time zone, e.g. `America/Los_Angeles`, so "today" is the person's local day.

Response `200`:

```json
{
  "date": "2026-10-13",
  "entries": [
    {
      "id": "d_2026-10-13_c_acme",
      "client_id": "c_acme",
      "description": "Reviewed and answered the Acme renewal emails",
      "minutes": 45,
      "started_at": "2026-10-13T16:02:11Z",
      "ended_at": "2026-10-13T16:47:00Z",
      "block_ids": ["0B2D6C1E-7A4F-4E21-8D3B-5C9A1F2E6B70"],
      "status": "pending",
      "edited": false
    }
  ]
}
```

- `status`: `pending`, `accepted`, or `rejected`. `edited`: the person changed the description, minutes, or client.
- `client_id` may be `null` (no client). The app shows client names from its synced list, so names don't need to be in the draft.
- Times may include fractional seconds. `started_at`, `ended_at`, `block_ids`, `status`, and `edited` are optional.
- The app shows the total of entries that aren't rejected.

## POST /v1/drafts/entries/:id/review

The person's decision on one entry. `:id` is URL-encoded.

```json
{ "action": "accept", "description": "Renewal emails with Acme legal", "minutes": 40, "client_id": "c_globex" }
```

- `action`: `accept` (approve, applying any fields sent), `reject` (not work to record), or `edit` (save changes, keep it pending). Reviewing again replaces the earlier decision.
- `description`, `minutes` (1 to 1440), and `client_id` are present only if the person changed them. **`"client_id": null` means "no client"; a missing `client_id` means "keep the current client".** Descriptions the person typed have gone through their redaction choices.

Response `200`: the entry as it now stands (same shape as in the draft).

## DELETE /v1/me/data

Deletes everything this device sent. Response `204` with an empty body. (The app has the call; the button for it comes later.)

## Defined later

Not used by the app yet:

- `POST /v1/baseline`
