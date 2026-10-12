# Constellation backend contract (Mac app side)

Request and response shapes the Mac app uses. The endpoint list comes from the team plan; the bodies below are what the app sends and expects today. `mac/mock-backend/server.mjs` implements them and is the reference if anything here is unclear.

All bodies are JSON. Times are ISO 8601 in UTC (`2026-10-12T17:02:11Z`). Keys are snake_case.

## Auth

`POST /v1/devices/register` returns a device token. Every other call sends it as `Authorization: Bearer <token>`. A `401` or `403` makes the app forget the token and ask the person to connect again.

The app accepts only `https` base URLs, except `http://localhost` for testing.

## Rules the backend can rely on

- **Everything is redacted on the device before it is sent.** Emails, phone numbers, street addresses, card numbers, SSNs, and API keys and tokens arrive as `[EMAIL]`, `[PHONE]`, `[ADDRESS]`, `[CARD]`, `[SSN]`, `[SECRET]`. Optionally private IPs arrive as `[IP]`, and people's names as `[Person 1]`, `[Person 2]` (stable within a session).
- **Only blocks the person approved are sent** (or auto approved, by their choice).
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

## DELETE /v1/me/data

Deletes everything this device sent. Response `204` with an empty body. (The app has the call; the button for it comes later.)

## Defined later

These arrive with the next steps, and their bodies will be added here then:

- `GET /v1/drafts/today` and `POST /v1/drafts/entries/:id/review`: the daily draft review screen (accept, edit, reject, change client).
- `POST /v1/baseline`
