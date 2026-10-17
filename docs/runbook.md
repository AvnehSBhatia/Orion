# Orion operations runbook

For whoever is on call for an Orion box. Setup is in [deploy.md](deploy.md). Commands are given for both setups:

- **Docker:** run from the repo root with `dc="docker compose -f deploy/docker-compose.yml"`.
- **systemd:** the units are `orion-server`, `orion-web`, `orion-backup.timer` and `caddy`.

Paths:

| | Docker | systemd |
|---|---|---|
| Settings | `deploy/.env` | `/etc/orion/orion.env` |
| Data | volume `orion-data` → `/data` | `/var/lib/orion/data` |
| Backups | `deploy/backups` → `/backups` | `/var/lib/orion/backups` |

`DATA_DIR` holds `auth.db` (accounts, sessions, tokens) and `orgs/<orgId>.db`, one SQLite file per org with captures, screenshots, the graph and embeddings.

---

## Deploy

First deploy: [deploy.md](deploy.md).

## Update

Before a risky update, run a backup first (see [Backups](#backups)).

Docker:

```sh
git pull
export ORION_VERSION=$(git rev-parse --short HEAD)
$dc build && $dc up -d
$dc ps                         # server becomes healthy within ~1 min
echo "$(date -u +%FT%TZ) $ORION_VERSION" >> deploy/deploys.log
```

systemd:

```sh
sudo /opt/orion/deploy/systemd/orion-update.sh            # pulls, builds, restarts, waits for /api/health
```

Expect a minute or two of degraded service on the systemd path (it builds in place), and a few seconds on Docker (the container swaps).

## Rollback

Docker: start the previous image tag. Old images stay until you prune them.

```sh
docker image ls orion-server   # find the previous tag
ORION_VERSION=<previous> $dc up -d
```

systemd: redeploy the previous sha, which `orion-update.sh` printed and logged:

```sh
tail -5 /var/lib/orion/deploys.log
sudo /opt/orion/deploy/systemd/orion-update.sh <previous-sha>
# later, back on the branch: sudo -u orion git -C /opt/orion checkout main && sudo /opt/orion/deploy/systemd/orion-update.sh
```

Schema changes are additive today (new tables and columns), so older code runs against a newer database. If a release notes a migration that isn't backward compatible, roll back by restoring the backup taken before the update.

## Logs

| | Docker | systemd |
|---|---|---|
| API | `$dc logs -f --tail 200 server` | `journalctl -u orion-server -f` |
| Web | `$dc logs -f web` | `journalctl -u orion-web -f` |
| Proxy (JSON access log) | `$dc logs -f caddy` | `journalctl -u caddy -f` |
| Backups | cron log file | `journalctl -u orion-backup -n 100` |

Logs can include fragments of captured content (model errors echo part of the provider response). Treat them as confidential. Docker rotates at 5×20 MB per container, and journald follows its own `SystemMaxUse`.

## Health

```sh
curl -s https://api.<domain>/api/health | jq
# { ok, version, checks: { orgsDir, authDb, embedder: ready|loading|error, llmKey } }  — 503 when a check fails
```

- **`embedder: loading`** right after a start is normal (the Gemma model loads or downloads). It stays `loading` or `error` if the model cache volume is full or unwritable.
- **`llmKey: false`** means `OPENROUTER_API_KEY` is missing.
- **Monitor it:** point an uptime monitor (Better Stack, UptimeRobot, healthchecks.io) at `/api/health` every minute; a box that is down cannot report itself. Also alert on a missed backup ping (`HEALTHCHECK_URL`).
- **Alerts from the server:** set `ALERT_WEBHOOK_URL` to a Slack or Discord incoming webhook. Every 5 minutes the server checks the data disk (alert at `ALERT_DISK_PERCENT`, default 85) and the health check, and it alerts on `ALERT_ERROR_BURST` (default 10) server errors within 10 minutes. Each alert is sent at most once an hour and names counts and route paths only, never captured text.
- **Quick box checks:** `df -h /var/lib/orion` (or `docker system df`), `free -m`, and `journalctl -k | grep -i oom` (OOM kills).

## Backups

What runs:

1. `deploy/backup/orion-backup.sh` calls `server/scripts/backup.ts`, which writes online SQLite copies (safe while the server writes; never `cp` a live WAL database) into a timestamped directory.
2. The script runs `PRAGMA integrity_check` on every new file.
3. It deletes local copies older than `BACKUP_KEEP_DAYS` (default 7).
4. If `RCLONE_REMOTE` is set, it runs `rclone copy` to that remote and deletes remote copies older than `RCLONE_KEEP_DAYS` (default 35).
5. It pings `HEALTHCHECK_URL` on success, or `HEALTHCHECK_URL/fail` on failure.

Schedule:

- **systemd:** `orion-backup.timer`, daily at 03:15 UTC (box time) plus up to 15 min. Settings are in `/etc/orion/backup.env`.
- **Docker:** a host cron line:

  ```cron
  15 3 * * * cd /opt/orion && set -a && . deploy/backup.env && set +a && ORION_BACKUP_MODE=docker deploy/backup/orion-backup.sh >> /var/log/orion-backup.log 2>&1
  ```

Set up the offsite copy once:

```sh
sudo -u orion rclone config --config /etc/orion/rclone.conf   # Docker host: plain `rclone config`
#   1. add the bucket remote: s3 (AWS, or Cloudflare R2 via provider=Cloudflare) or b2
#   2. add a "crypt" remote over it (e.g. orion-crypt -> b2remote:acme-orion-backups/prod)
#      and store the crypt passwords in your password manager. Without them the backups can't be read.
# then in backup.env: RCLONE_REMOTE=orion-crypt:prod
sudo systemctl start orion-backup && journalctl -u orion-backup -n 50
rclone ls orion-crypt:prod | head
```

Bucket hygiene:

- Use a key scoped to that one bucket.
- Turn on versioning or object lock if the provider has it, so a compromised box can't delete the history.
- If you rely on a bucket lifecycle rule for retention, set `RCLONE_KEEP_DAYS=0`.

Manual backup before risky work:

- systemd: `sudo systemctl start orion-backup`
- Docker: `ORION_BACKUP_MODE=docker deploy/backup/orion-backup.sh`

## Restore

Find the backup to restore, either in the local backup dir or offsite:

```sh
rclone lsd orion-crypt:prod
rclone copy orion-crypt:prod/<timestamp> /tmp/restore/<timestamp>
```

It mirrors `DATA_DIR`: `auth.db` and `orgs/<orgId>.db`. Check the layout `backup.ts` printed if it differs.

Full restore (systemd):

```sh
sudo systemctl stop orion-server
sudo mv /var/lib/orion/data /var/lib/orion/data.broken-$(date +%s)      # keep it until the restore is verified
sudo install -d -o orion -g orion -m 700 /var/lib/orion/data /var/lib/orion/data/orgs
sudo cp /tmp/restore/<timestamp>/auth.db /var/lib/orion/data/
sudo cp /tmp/restore/<timestamp>/orgs/*.db /var/lib/orion/data/orgs/
sudo chown -R orion:orion /var/lib/orion/data && sudo chmod -R go-rwx /var/lib/orion/data
sudo systemctl start orion-server
curl -fsS http://127.0.0.1:3001/api/health
```

Full restore (Docker):

```sh
$dc stop server
docker run --rm -v orion_orion-data:/data -v /tmp/restore/<timestamp>:/restore:ro alpine sh -c \
  'mkdir -p /data/broken && mv /data/auth.db /data/orgs /data/broken/ 2>/dev/null; rm -f /data/*.db-wal /data/*.db-shm;
   mkdir -p /data/orgs && cp /restore/auth.db /data/ && cp /restore/orgs/*.db /data/orgs/ && chown -R 1000:1000 /data && chmod -R go-rwx /data'
$dc start server
```

Restoring one org: stop the server, replace only `orgs/<orgId>.db` (and delete its `-wal`/`-shm` files), then start the server. `auth.db` is shared by all orgs, so restore it only for an account-level problem.

After a restore, everything since the backup is gone: captures, accounts, and tokens issued since then. Tell affected users. Extensions keep posting new captures as soon as the server is back.

## Restore drill

Run this monthly (and before launch), and write the result in your ops log. It proves the offsite copy can be read and restored without touching production.

1. Pull yesterday's offsite backup to a scratch dir:

   ```sh
   rclone copy orion-crypt:prod/<timestamp> /tmp/drill
   ```

2. Check every file:

   ```sh
   for f in /tmp/drill/auth.db /tmp/drill/orgs/*.db; do echo "$f $(sqlite3 -readonly "$f" 'PRAGMA integrity_check')"; done
   ```

3. Compare counts with production. They should be close to production, minus a day:

   ```sh
   sqlite3 -readonly /tmp/drill/auth.db 'select count(*) from accounts'
   sqlite3 -readonly /tmp/drill/orgs/<org>.db '.tables'   # pick the sources table and count rows
   ```

4. Boot a throwaway API on the copy. On a Docker host:

   ```sh
   docker run --rm -d --name orion-drill -p 127.0.0.1:3901:3001 --env-file deploy/.env \
     -e DATA_DIR=/data -e EMBED_PROVIDER=openrouter -v /tmp/drill:/data orion-server:$ORION_VERSION
   ```

   On a systemd box:

   ```sh
   cd /opt/orion/server && sudo -u orion env DATA_DIR=/tmp/drill PORT=3901 node node_modules/next/dist/bin/next start -p 3901 -H 127.0.0.1
   ```

   Run `chown -R orion /tmp/drill` first.

5. Check it:

   ```sh
   curl -s localhost:3901/api/health
   ```

   Then sign in through it with curl (`POST /api/auth/login`) and fetch one source.

6. Stop it and `rm -rf /tmp/drill`.

7. Record the date, the backup timestamp, the time it took and any problems.

The restore time objective is the time steps 1-5 took. The recovery point objective is 24 hours with the daily timer. Run the timer more often if that is too much.

## Rotate OPENROUTER_API_KEY

Rotate on a schedule (quarterly), when someone with access leaves, and immediately if the key leaks.

1. In OpenRouter, create a new key. Give it a credit limit, and check that the account's privacy settings still deny data collection and training.
2. Put it in `deploy/.env` or `/etc/orion/orion.env`.
3. Restart the API:
   - Docker: `$dc up -d server` (env changes need a recreate, not a restart)
   - systemd: `sudo systemctl restart orion-server`
4. Check `curl -s https://api.<domain>/api/health | jq .checks.llmKey`, then run one chat question in the dashboard.
5. Delete the old key in OpenRouter.
6. If it leaked, review OpenRouter's activity log for usage you don't recognize.

## Revoke tokens

API tokens are used by the extension, MCP clients and CI.

- **A user's own token:** `GET /api/auth/tokens` lists them, and `DELETE /api/auth/tokens/<id>` revokes one. A user can do this with their session. The dashboard will expose it as well.
- **All of a person's sessions and tokens:** disable the account (next section). Changing the password also signs out all sessions:

  ```sh
  account.ts password --username <u> --password '<new>'
  ```

- **A CI token:** revoke it, issue a new one (`account.ts token --username <ci-owner> --label ci`), and update the `ORION_TOKEN` secret in the repo.
- **Emergency (every token for every user):** stop the server, back up `auth.db`, and delete the rows from the token and session tables:

  ```sh
  sqlite3 auth.db '.tables'
  ```

  Start the server again. Everyone signs in again and reissues tokens.

## Disable an account

Admin API, from a signed-in admin session:

```sh
curl -X PATCH https://api.<domain>/api/auth/accounts/<username> \
  -H 'Content-Type: application/json' -H 'Origin: https://app.<domain>' \
  --cookie '<session cookie>' -d '{"disabled": true}'
```

You can also use the dashboard's admin page once it ships. Disabling revokes every session and token. The person's past captures and the work items derived from them stay, so delete them separately if required (next section). The last admin of an org can't disable themselves.

For offboarding: disable the account, ask the person to remove the extension (or remove it through Chrome enterprise policy), and rotate any CI token they created.

## Data deletion request

These come from an employee (GDPR Art. 17, CCPA) or from the customer org. Log every request with the date, requester, scope and completion date. The audit log (`GET /api/audit`) records `data_deleted` events.

1. **Verify the request.** For a person, confirm it comes from them or from their employer's admin, depending on the DPA. For a whole org, require a written request from the customer's account owner.
2. **Choose the scope:**
   - **Own captures:** the person runs `DELETE /api/me/captures` (or uses "delete my data" in settings). This removes their captured documents and screenshots.
   - **A person entirely:** an admin runs `DELETE /api/users/<userId>`. This removes the person, their captures and their account.
   - **A whole org:** an admin runs `DELETE /api/orgs/<orgId>` with `{"confirm":"<orgId>"}`. This removes `orgs/<orgId>.db` and the org's accounts.
3. **Backups:** deleted data stays in backups until they age out (7 days local, `RCLONE_KEEP_DAYS` offsite, 35 by default). Say so in the reply. Don't edit backups. If a restore happens inside that window, re-apply the deletion right after restoring. Keep the request log so you can.
4. **Subprocessors:** OpenRouter requests are sent with data collection denied, so providers shouldn't retain the content. Nothing else is held off the box.
5. **Confirm in writing** to the requester within the legal deadline (GDPR: one month).

## Incident checklist

1. **Triage (first 15 min):**
   - What's broken, since when, for whom?
   - Run `curl /api/health`, `$dc ps` or `systemctl status orion-*`, `df -h` and `free -m`, and read the last 200 log lines.
2. **Stabilize:**
   - Restart the failing service.
   - If disk is full, delete old local backups (`find <backup dir> -mtime +2 -delete`) and Docker images (`docker image prune`).
   - If a deploy caused it, roll back.
   - If the model provider is down, chat and extraction fail but captures are still stored. Post a status note.
3. **Suspected security incident** (leaked key or token, unknown admin, data exposure):
   - Preserve evidence first: copy the logs and the audit log (`GET /api/audit`), and snapshot the disk if the host allows it.
   - Contain:
     - Rotate `OPENROUTER_API_KEY`.
     - Revoke the affected tokens or all tokens.
     - Disable the affected accounts.
     - Block IPs at the firewall if useful.
     - If the box itself may be compromised, build a new box from the repo and restore from a backup taken before the incident.
   - Assess what data was exposed (which orgs and people) from the audit log and access logs.
   - **Notify:** the customer's contact without undue delay (the DPA says within 48 hours of confirming). The customer, as controller, decides on regulator notice (GDPR: within 72 hours) and notice to employees.
4. **Communicate:** one owner posts updates to affected customers at a fixed interval until it's resolved.
5. **Afterwards:** write a postmortem within 5 working days (timeline, cause, what detected it, fixes with owners). Add any missing alert or runbook step here.
