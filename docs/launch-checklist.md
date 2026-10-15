# Launch checklist: steps for a human

These are the steps code can't do for you. Do them roughly in this order. The engineering P0s are tracked separately in [production-checklist.md](production-checklist.md).

## Accounts and infrastructure

- [ ] **Buy the domain.** Turn on registrar lock and 2FA on the registrar account.
- [ ] **Rent the box** (sizing: [deploy.md](deploy.md#box-sizing)). Use 2 GB for a pilot with OpenRouter embeddings, or 4 GB+ for local embeddings. Pick a region that matches where the customers are (EU customers: EU region).
- [ ] **Turn on disk encryption** for the box's data volume:
  - Use provider-managed volume encryption, or LUKS on a separate volume mounted at `/var/lib/orion` (systemd) or `/var/lib/docker` (Docker).
  - Write down where the key lives.
- [ ] **Lock down SSH:** keys only (`PasswordAuthentication no`), a named user per operator, no shared root login.
- [ ] **DNS:** A/AAAA records for `app.<domain>` and `api.<domain>` → the box. Add a CAA record for `letsencrypt.org`.
- [ ] **Deploy** with [deploy.md](deploy.md), then confirm `https://api.<domain>/api/health` returns 200.

## OpenRouter

- [ ] **Create an OpenRouter account** for the company, with 2FA, not a personal account.
- [ ] **Settings → Privacy:**
  - Turn off "allow providers that may train on inputs" and prompt logging, so data collection is denied account-wide as well as per request.
  - Decide whether providers hosted in China are allowed for the configured models.
  - Record the decision in [legal/subprocessors.md](legal/subprocessors.md).
- [ ] **Create the production API key** with a monthly credit limit. Put it in the env file. Store a copy in the company password manager.
- [ ] **Add credits and a low-balance alert.**

## Backups

- [ ] **Create the offsite bucket** (S3, B2 or R2):
  - in a different provider or region from the box
  - versioning or object lock on
  - a key scoped to that bucket
- [ ] **Configure rclone** with a `crypt` remote, and store the crypt passwords in the password manager ([runbook.md](runbook.md#backups)).
- [ ] **Run the first backup by hand,** then run the [restore drill](runbook.md#restore-drill) once.
- [ ] **Monitoring:**
  - an uptime monitor on `/api/health`
  - a heartbeat for the backup job (`HEALTHCHECK_URL`)
  - a disk-usage alert
  - alerts going to someone's phone

## Chrome Web Store

- [ ] **Register a Chrome Web Store developer account** (one-time fee, company Google account with 2FA). Verify the publisher.
- [ ] **Prepare the listing:**
  - icons and screenshots
  - the privacy policy URL
  - the answers in [legal/chrome-web-store-disclosures.md](legal/chrome-web-store-disclosures.md)
- [ ] **Build with the production backend** as the default, and submit. Review can take days to weeks. Start early.
- [ ] **After approval,** put the published extension id in `EXTENSION_IDS` and restart the API.

## Legal

- [ ] **Counsel review** of everything in [docs/legal/](legal/): privacy policy, monitoring notice, DPA, subprocessors, security overview, Web Store disclosures. Also terms of service, which haven't been drafted yet.
- [ ] **Publish** the privacy policy, subprocessor list and security overview at stable URLs.
- [ ] **Sign DPAs with the subprocessors:**
  - the hosting provider
  - the backup storage provider
  - OpenRouter: accept its DPA and terms and keep a copy
- [ ] **For each customer:**
  - Sign the DPA.
  - Agree on the monitoring notice text.
  - Confirm they've done any works council consultation, employee notice and DPIA their jurisdiction needs.

## First admin and first customer

- [ ] **Create the first admin** with `server/scripts/account.ts` ([deploy.md](deploy.md#first-admin)). Keep that password in the password manager.
- [ ] **Set the org's capture settings:** retention, excluded sites, screenshot visibility, monthly LLM budget, and the notice text.
- [ ] **Do one end-to-end pass as a member:**
  1. sign in
  2. accept the notice
  3. capture a tab
  4. see it in the dashboard
  5. delete it
- [ ] **CI sync (optional):** in the customer's repo, set the `BACKEND_URL`, `ORION_ORG_ID` and `ORION_TOKEN` secrets for `ctx-sync.yml`.
