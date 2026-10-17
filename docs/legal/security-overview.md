# Orion Security Overview

How Orion protects customer data, for security reviews and vendor questionnaires. Contact: [security contact email].

## Architecture

- Orion runs on one virtual server at [hosting provider], in [region]. On it:
  - a web app
  - an API server
  - Caddy, a reverse proxy that handles TLS
- Each customer organization's data lives in its own SQLite database file. A separate database holds accounts, tokens and the audit log.
- Every API request is checked against the caller's organization. Requests for another organization's data are refused.
- Data comes from:
  - the Orion Mac app (work blocks a person approves)
  - an optional GitHub Action in the customer's repositories (commit changes)
  - the web app
  - the older Orion Chrome extension, for organizations that still use it
- Coding assistants read Orion data over an authenticated MCP endpoint, with the person's own token.

## The Mac app

- Reads text through macOS Accessibility, only from apps the person turns on. Every app starts off. Password managers, Keychain and System Settings can't be turned on.
- Never takes screenshots. Skips password fields and private or incognito windows.
- In browsers, keeps the title and the domain and path of the address. Query strings are dropped. Page text is read only if both the organization and the person turn it on.
- Removes card numbers, Social Security numbers, and API keys and tokens on the device before anything is saved. Emails, phone numbers and street addresses are removed by default. Names can be masked.
- Keeps captured items in a local store encrypted with AES-GCM, with the key in the macOS Keychain. Text there is cleared after 30 days.
- Sends nothing until the person accepts the organization's monitoring notice. Items wait in an Outbox, where the person can edit or delete them. By default they are approved automatically after 30 minutes. The person can turn that off.
- The server checks every work block again and refuses any that hold a card number or an API key, or come from a site the organization blocks.

## Encryption

- **In transit:**
  - All traffic to Orion uses HTTPS. Caddy gets and renews certificates from Let's Encrypt. HSTS is on.
  - The Chrome extension only talks to HTTPS servers (or to localhost).
  - Calls to OpenRouter use HTTPS.
- **At rest:**
  - Database files are readable only by the Orion service account. Orion does not encrypt the live database files itself. Disk encryption depends on the host's volume setup.
  - Backups are encrypted on the server with rclone crypt before upload. The keys are not stored with the backup provider.
- **Credentials:**
  - Passwords are hashed with scrypt and a random salt per password.
  - Session, API, CI and device tokens are random 256-bit values. Only their SHA-256 hash is stored.

## Sign-in and access control

- People sign in with a username and password. There is no SSO or two-factor sign-in yet.
- **Sessions** are HttpOnly cookies (Secure in production, SameSite=Lax) that expire after 30 days. There is no idle timeout.
- **Sign-in protection:** 10 failed sign-ins for one IP address and username within 15 minutes block more tries for a while. Sign-ins for unknown usernames take as long as real ones.
- **Tokens:**
  - **API tokens** (for MCP and scripts) act as the person. They can be labeled, given an expiry, and revoked at any time.
  - **CI tokens** for GitHub sync can only send commits. Only admins can create them. The web app sets them to expire after one year.
  - **Mac device tokens** work only on the Mac app's API, not the rest of Orion.
  - Disabling an account revokes all its tokens.
- **Roles:**
  - **Admins** manage members, settings, retention and deletions, and can export time entries.
  - **Members** see their organization's work items.
  - Text from a person's Mac is visible only to that person and admins.
  - Screenshots from the older extension are visible only to their author and admins by default.
  - Viewing Orion as another person is admin only, and each time is recorded in the audit log.
- **Browser protections:**
  - Writes made with a session cookie must send JSON and come from the Orion web app's origin (CSRF protection).
  - Only the configured Orion extension ids get credentialed cross-origin access.
  - Security headers: HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy and Permissions-Policy.
- **Rate limits:** each caller has limits per kind of request (sending data, asking questions, account actions, and everything else).
- **Spend cap:** each organization has a monthly cap on AI spend ($50 by default). Past it, model steps are skipped.
- **Operator access to the server:**
  - SSH only
  - the firewall allows only SSH, HTTP and HTTPS
  - automatic security updates are on

## Audit log

Orion records security events for each organization, and admins can review them:

- sign-ins, failed sign-ins and sign-outs
- token creation and revocation
- account creation and changes
- invites
- password changes and resets
- settings changes
- Mac device connections
- notice acceptance, with its version
- data deletions
- admins viewing Orion as another person

The audit log is kept when an organization is deleted.

## Privacy controls

- **Person's controls:** pick which Mac apps are read, a personal skip list of sites and words, redaction choices, the Outbox, pause or turn off capture from the menu bar, delete their own data, and download a copy of it.
- **Admin controls:** block sites for everyone, turn capture off for the whole organization, allow or block browser page text on Macs, set retention, set who sees extension screenshots, and ask everyone to accept the notice again.
- **Retention defaults:** Mac text 14 days, documents (captures and commits) 90 days, extension screenshots 14 days. Work items and time entries stay until deleted.
- **Deletion:** a person can delete their own data. An admin can delete a person, with everything they captured, or the whole organization. Work items already built from deleted captures stay.

## AI and third parties

- Model calls go through OpenRouter. Every call denies data collection. Model calls also require zero data retention, and each model is pinned to named hosts outside China. Customer data is never used to train models.
- When a model call fails, we log its status, never the prompt or the model's answer.
- Outbox summaries before approval are not stored or logged.
- Search embeddings are made on our own server by default.
- The full list is in our subprocessor list.

## Availability and backups

- Daily online backups of every database, with integrity checks.
- Local copies kept for 7 days. Encrypted offsite copies on Cloudflare R2 kept for 35 days.
- A restore drill from the offsite copy is part of our monthly runbook.
- The server checks its disk and health every 5 minutes and alerts on bursts of errors. Alerts carry counts and route paths only. Services restart on failure.

## Development

- CI runs type checks, tests, lint and builds on every pull request and on pushes to the main branches, plus `npm audit` for high-severity issues in production dependencies.
- Dependabot opens weekly dependency updates.
- Secrets live in environment files on the server, readable only by the service, never in the repository.

## Incident response

A written runbook covers triage, containment, keeping evidence, telling people, and a postmortem afterwards. We tell customers about a personal data breach within 48 hours of confirming it (see the DPA).

## Not offered yet

SSO or SAML, two-factor sign-in, idle session timeout, SOC 2 or ISO 27001 reports, customer-managed keys, and a choice of data region.
