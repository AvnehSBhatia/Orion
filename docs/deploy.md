# Deploying Orion

Orion runs on one box: the API (`server/`, port 3001), the dashboard (`web/`, port 3000), and Caddy in front for HTTPS. Data is SQLite on local disk, so it is one box and one API process. Don't run two API processes against the same `DATA_DIR`.

```
            ┌──────────── one box ────────────────────────────────┐
browser ──▶ │ Caddy :443  app.<domain> ──▶ web    :3000 (Next.js)  │
extension ─▶│             api.<domain> ──▶ server :3001 (Next.js)  │──▶ OpenRouter
CI, MCP ──▶ │                                 │                    │
            │          DATA_DIR (orgs/*.db, auth.db)               │
            │          MODEL_CACHE_DIR (EmbeddingGemma, tesseract) │
            └─────────────────────────────────────────────────────┘
```

You can deploy in two ways. Both use the same `deploy/Caddyfile` and the same env template (`deploy/.env.example`):

- **Docker Compose** (`deploy/docker-compose.yml`). Simplest to update and roll back.
- **systemd on a plain Ubuntu VPS** (`deploy/setup-ubuntu.sh`). No Docker, and the smallest memory footprint.

The day-2 work (updates, logs, backups, incidents) is in [runbook.md](runbook.md). The manual steps before launch are in [launch-checklist.md](launch-checklist.md).

## Box sizing

| RAM | Settings | Notes |
|---|---|---|
| 1 GB | `EMBED_PROVIDER=openrouter`, 2 GB swap | Works for a pilot team. `next build` swaps, so a deploy takes a few minutes. Page text goes to the embedding provider. |
| 2 GB | `EMBED_PROVIDER=openrouter`, 2 GB swap | Comfortable for most small teams. |
| 4 GB+ | `EMBED_PROVIDER=gemma` allowed | Embeddings run in the API process: about 1 GB resident, peaking near 2 GB during an image embed. Text doesn't leave the box for embedding. |

Other numbers to plan for:

- **CPU:** 1-2 vCPU is enough with OpenRouter embeddings. With local Gemma, an image embed takes about 2 s of CPU, so use 2-4 vCPU.
- **Disk:** about 7 MB of screenshots per person per day before retention runs. The default retention keeps screenshots 14 days and text 90 days, so plan on roughly 100-150 MB per person, plus about 1 GB for the model cache and room for 7 days of local backups. 25 GB is fine for about 50 seats.
- **Switching providers:** changing `EMBED_PROVIDER` re-embeds each org once.

`setup-ubuntu.sh` sizes swap from RAM: 2 GB on boxes up to 2 GB, otherwise half of RAM, capped at 4 GB. It also sets `vm.swappiness=10`.

## Option A: Docker Compose

On any Linux host with Docker Engine and the compose plugin (`curl -fsSL https://get.docker.com | sh`):

```sh
git clone <repo-url> /opt/orion && cd /opt/orion
cp deploy/.env.example deploy/.env && chmod 600 deploy/.env
$EDITOR deploy/.env                          # ORION_DOMAIN, ACME_EMAIL, OPENROUTER_API_KEY, EXTENSION_IDS
mkdir -p deploy/backups && sudo chown 1000:1000 deploy/backups && chmod 700 deploy/backups
export ORION_VERSION=$(git rev-parse --short HEAD)
docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml ps   # server should turn "healthy" once /api/health answers
```

What the compose setup does:

- Builds `orion-server:<ORION_VERSION>` and `orion-web:<ORION_VERSION>`.
- `NEXT_PUBLIC_ORION_API` is baked into the web build as `https://api.<ORION_DOMAIN>`.
- Data lives on the `orion-data` volume (`/data`) and models on `orion-models` (`/models`). The model downloads on first use and then persists.
- Containers run as the unprivileged `node` user (uid 1000), and only the volumes and `.next/cache` are writable.
- Forces `COOKIE_SECURE=true`, `TRUST_PROXY=true`, `AUTH_DISABLED=false` and `UI_ORIGIN=https://app.<domain>`.
- The server container has a memory limit (`SERVER_MEM_LIMIT`, default 3g) and restarts if it is OOM-killed. On a 1-2 GB box, set it to about `900m` with `EMBED_PROVIDER=openrouter`.
- Firewall: open only 22, 80 and 443 (`ufw allow OpenSSH; ufw allow 80/tcp; ufw allow 443`). Docker publishes only Caddy's ports.

Backups on a Docker host: add the cron line from the top of `deploy/backup/orion-backup.sh`, with `ORION_BACKUP_MODE=docker` and the `RCLONE_*` settings (see [runbook.md](runbook.md#backups)).

## Option B: systemd on Ubuntu

```sh
sudo ORION_REPO=https://github.com/<org>/<repo>.git ORION_BRANCH=main \
     ORION_DOMAIN=example.com ACME_EMAIL=ops@example.com \
     bash deploy/setup-ubuntu.sh
```

It installs and configures:

- Node 22 (NodeSource), Caddy (official apt repo), sqlite3, rclone.
- An `orion` system user.
- The swap file.
- ufw allowing ssh, 80 and 443 only.
- unattended-upgrades for security patches.

Layout:

| Path | What |
|---|---|
| `/opt/orion` | git checkout, owned by `orion`, built in place |
| `/etc/orion/orion.env` | settings and secrets (root:orion, 640) |
| `/etc/orion/backup.env`, `/etc/orion/rclone.conf` | backup settings and the offsite remote |
| `/var/lib/orion/data` | `DATA_DIR` (700) |
| `/var/lib/orion/models` | `MODEL_CACHE_DIR` |
| `/var/lib/orion/backups` | local backups (700) |
| `orion-server.service`, `orion-web.service` | bound to 127.0.0.1, hardened (`ProtectSystem=strict`, `NoNewPrivileges`, `UMask=0077`), `Restart=always` |
| `orion-backup.timer` | daily at 03:15 plus up to 15 min of jitter |

To update or roll back, run `sudo /opt/orion/deploy/systemd/orion-update.sh [git-ref]`.

## DNS and cookies

Create A (and AAAA) records for `app.<domain>` and `api.<domain>` pointing at the box. Caddy fetches the certificates on the first request to each name, so DNS has to resolve first.

Keep the dashboard and the API on sibling subdomains of one registrable domain (for example `app.acme.com` and `api.acme.com`). The session cookie is set by the API and must count as same-site for the dashboard. Putting them on unrelated domains breaks sign-in.

`UI_ORIGIN` must be exactly `https://app.<domain>`, because it drives CORS and the CSRF origin check.

## First admin

Accounts are created with `server/scripts/account.ts` on the box. It writes `auth.db` and the org file directly, so run it where the server's `DATA_DIR` is.

The org id becomes the file name `orgs/<org>.db`: lowercase letters, digits and dashes. The user id is the person's id in the graph (for example a first name).

Docker:

```sh
docker compose -f deploy/docker-compose.yml exec server \
  node_modules/.bin/tsx scripts/account.ts create \
  --username mina --password 'a-long-passphrase' --org acme --user mina --name "Mina Park" --admin
```

systemd:

```sh
cd /opt/orion/server
sudo -u orion -H env DATA_DIR=/var/lib/orion/data node_modules/.bin/tsx --env-file=/etc/orion/orion.env \
  scripts/account.ts create --username mina --password 'a-long-passphrase' --org acme --user mina --name "Mina Park" --admin
```

Notes:

- Wrap the password in single quotes and clear your shell history afterwards (`history -d`), or prefix the command with a space if `HISTCONTROL=ignorespace` is set.
- To issue an API token for CI or MCP, run `account.ts token --username mina --label "ci"`. The token is shown once.
- Then sign in at `https://app.<domain>`. Invite the rest of the team from the dashboard once the invite flow ships; until then, use `account.ts create` without `--admin`.

## Checks after the first deploy

```sh
curl -fsS https://api.<domain>/api/health                                # 200 with every check ok
curl -sI https://app.<domain> | grep -i strict-transport-security
curl -s -o /dev/null -w '%{http_code}\n' https://api.<domain>/api/feed   # 401 without a session
```

Then sign in, install the extension pointed at `https://api.<domain>`, capture a tab, and confirm it shows up.

Finally, run one backup by hand, then a restore drill (see [runbook.md](runbook.md#restore-drill)).
