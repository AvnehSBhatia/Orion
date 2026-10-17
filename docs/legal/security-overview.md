> **DRAFT — needs review by counsel** (and by engineering before each publish). Items marked [at launch] depend on work tracked in `docs/production-checklist.md`. Don't publish a claim until it ships.

# Orion Security Overview

How Orion protects customer data, for security reviews and vendor questionnaires. Contact: [security@domain].

## Architecture

- Orion runs on dedicated servers at [hosting provider, region]. The parts are:
  - a web dashboard
  - an API
  - a reverse proxy that terminates TLS
- Each customer organization's data lives in its own database file. A separate database holds accounts and credentials.
- Every API request is checked against the caller's organization. Requests for another organization's data are refused (403).
- Data comes from:
  - the Orion Chrome extension (captures the user picks)
  - an optional CI job in the customer's repositories (commit changes)
  - the dashboard
- Coding assistants read context over an authenticated MCP endpoint.

## Encryption

- **In transit:**
  - All traffic uses HTTPS (TLS 1.2+, certificates from Let's Encrypt, renewed automatically). HSTS is enabled.
  - The extension only talks to HTTPS backends [at launch].
  - Calls to AI providers go over HTTPS.
- **At rest:**
  - Production disks are encrypted at the volume level [confirm per host: provider-managed volume encryption or LUKS].
  - Database directories are readable only by the service account.
  - Backups are encrypted on the server (rclone crypt, with keys kept outside the backup provider) before upload.
- **Credentials:**
  - Passwords are hashed with scrypt and a per-password salt.
  - Session and API tokens are random 256-bit values. Only their SHA-256 hash is stored.

## Authentication and access control

- Users sign in with a username and password. Sessions are HttpOnly, Secure cookies that expire (30 days today; idle timeout [at launch]).
- **Login protection:** sign-in attempts are rate limited, and logins for unknown usernames take the same time as real ones.
- **API tokens** for the extension, MCP and CI:
  - per user and labeled
  - revocable at any time
  - every token is revoked when an account is disabled
- **Roles:**
  - **Admins** manage members, settings, retention and deletions.
  - **Members** see their organization's work map.
  - **Screenshots** are visible only to the person who captured them and to admins by default.
  - Acting on behalf of another user ("viewing as") is admin-only [at launch].
- **Browser protections:**
  - Cookie-authenticated writes require a JSON body and a matching Origin (CSRF protection) [at launch].
  - Only the published Orion extension id gets credentialed CORS access.
  - Security headers: HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy.
- **Operator access to production:**
  - limited to [named roles]
  - SSH keys only, no passwords
  - firewall allows only SSH, HTTP and HTTPS
  - automatic security updates

## Audit log

Orion records security-relevant events per organization, and admins can review them [at launch]:

- sign-ins and failed sign-ins
- sign-outs
- token creation and revocation
- account creation and changes
- password changes and resets
- invites
- settings changes
- data deletions

## Data minimization and privacy controls

- **The user decides what's shared:**
  - The extension captures only the tabs, windows and screens a user chooses, only while recording.
  - It never captures incognito windows or password fields.
- **Consent and pausing:**
  - Recording requires accepting the organization's monitoring notice first [at launch].
  - A badge shows when recording is on, and the user can pause at any time.
- **Admin controls:**
  - Admins can exclude sites so they're never captured.
  - Admins can switch capture off for the whole organization.
- **Retention** is configurable. The defaults remove screenshots after 14 days and captured text after 90 days.
- **Deletion:**
  - Users can delete their own captures.
  - Admins can delete a person (with their captures) or the whole organization.

## AI and third parties

- Captured text is sent to AI models through OpenRouter to extract work items and answer questions. Requests are sent with data collection denied, so only providers that don't retain or train on prompts are used. Customer data is never used to train models.
- Screenshots aren't sent to AI providers [confirm for the configured embedding mode].
- The full list is in the [Subprocessor List].
- Each organization has a monthly AI spend cap [at launch].

## Availability and backups

- Daily online backups of every database, with integrity checks.
- Encrypted copies kept offsite for [35] days.
- Restores are tested monthly. Target recovery point: 24 hours. Target recovery time: [4] hours.
- Health is monitored every minute with alerting. Services restart automatically on failure.

## Secure development

- All changes go through pull requests with CI: type checks, unit tests, lint, builds, and dependency vulnerability checks.
- Dependabot opens weekly dependency updates.
- Secrets live in environment files readable only by the service, never in the repository.

## Incident response

A documented runbook covers triage, containment, evidence preservation and communication. Customers are notified of a personal data breach within [48] hours of confirmation (see the DPA).

## Not yet offered

SSO/SAML, 2FA, SOC 2 or ISO 27001 reports, customer-managed keys, data residency choices. [Update as these ship.]
