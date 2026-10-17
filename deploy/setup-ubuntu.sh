#!/usr/bin/env bash
# One-time setup of a plain Ubuntu 22.04/24.04 VPS for Orion without Docker:
# Node 22, an "orion" system user, a swap file sized by RAM, ufw, unattended-upgrades, Caddy,
# the systemd units in deploy/systemd, the daily backup timer, and a first build.
#
#   curl -fsSLO https://raw.githubusercontent.com/<org>/<repo>/<branch>/deploy/setup-ubuntu.sh
#   sudo ORION_REPO=https://github.com/<org>/<repo>.git ORION_BRANCH=main \
#        ORION_DOMAIN=example.com ACME_EMAIL=ops@example.com bash setup-ubuntu.sh
#
# Safe to re-run: existing env files, swap and the checkout are left alone.
# For a private repo, use a read-only deploy key or an https URL with a fine-grained token.
set -euo pipefail

: "${ORION_REPO:?set ORION_REPO to the git URL}"
ORION_BRANCH="${ORION_BRANCH:-main}"
: "${ORION_DOMAIN:?set ORION_DOMAIN (app.<domain> and api.<domain> must point at this box)}"
: "${ACME_EMAIL:?set ACME_EMAIL, the TLS certificate contact}"
NODE_MAJOR="${NODE_MAJOR:-22}"

app=/opt/orion
state=/var/lib/orion
etc=/etc/orion

[ "$(id -u)" = 0 ] || { echo "run as root (sudo)" >&2; exit 1; }
. /etc/os-release
[ "${ID:-}" = ubuntu ] || echo "warning: tested on Ubuntu, this is ${PRETTY_NAME:-unknown}" >&2
export DEBIAN_FRONTEND=noninteractive
say() { printf '\n==> %s\n' "$*"; }

say "Base packages"
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg git build-essential python3 sqlite3 rclone ufw \
  unattended-upgrades apt-listchanges debian-keyring debian-archive-keyring apt-transport-https

say "Node.js $NODE_MAJOR"
current_major="$(node -v 2>/dev/null | sed -e 's/^v//' -e 's/\..*//' || true)"
if [ "$current_major" != "$NODE_MAJOR" ]; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -y
  apt-get install -y nodejs
fi
node --version

say "Swap"
mem_kb="$(grep MemTotal /proc/meminfo | tr -s ' ' | cut -d' ' -f2)"
mem_mb=$(( mem_kb / 1024 ))
if [ "$(swapon --show --noheadings | wc -l)" -eq 0 ]; then
  # 1-2GB boxes get 2GB (next build and an embed spike need the headroom); bigger boxes get RAM/2, max 4GB.
  if [ "$mem_mb" -le 2048 ]; then swap_mb=2048; else swap_mb=$(( mem_mb / 2 )); [ "$swap_mb" -gt 4096 ] && swap_mb=4096; fi
  fallocate -l "${swap_mb}M" /swapfile || dd if=/dev/zero of=/swapfile bs=1M count="$swap_mb"
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "created ${swap_mb}MB swap for ${mem_mb}MB RAM"
else
  echo "swap already present"
fi
echo 'vm.swappiness=10' > /etc/sysctl.d/90-orion-swap.conf
sysctl -q --system

say "Firewall (ssh, http, https)"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

say "Unattended security upgrades"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
systemctl enable --now unattended-upgrades

say "Caddy"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

say "User and directories"
id orion >/dev/null 2>&1 || useradd --system --home-dir "$state" --create-home --shell /usr/sbin/nologin orion
install -d -o orion -g orion -m 0700 "$state" "$state/data" "$state/models" "$state/backups"
# Mac app releases (DOWNLOADS_DIR defaults to $DATA_DIR/downloads); see docs/deploy.md, Mac app releases.
install -d -o orion -g orion -m 0755 "$state/data/downloads" "$state/data/downloads/mac"
install -d -o root -g orion -m 0750 "$etc"
install -d -o orion -g orion -m 0755 "$app"

say "Checkout $ORION_REPO ($ORION_BRANCH)"
if [ ! -d "$app/.git" ]; then
  sudo -u orion -H git clone --branch "$ORION_BRANCH" "$ORION_REPO" "$app"
fi

say "Config in $etc"
if [ ! -f "$etc/orion.env" ]; then
  sed -e "s|^ORION_DOMAIN=.*|ORION_DOMAIN=$ORION_DOMAIN|" \
      -e "s|^ACME_EMAIL=.*|ACME_EMAIL=$ACME_EMAIL|" \
      -e "s|^UI_ORIGIN=.*|UI_ORIGIN=https://app.$ORION_DOMAIN|" \
      "$app/deploy/.env.example" > "$etc/orion.env"
  echo "wrote $etc/orion.env: add OPENROUTER_API_KEY and EXTENSION_IDS"
fi
[ -f "$etc/backup.env" ] || cp "$app/deploy/backup/backup.env.example" "$etc/backup.env"
touch "$etc/rclone.conf"
chown root:orion "$etc"/orion.env "$etc"/backup.env "$etc"/rclone.conf
chmod 0640 "$etc"/orion.env "$etc"/backup.env
chmod 0660 "$etc"/rclone.conf   # rclone rewrites it when tokens refresh

say "Caddy config"
cp "$app/deploy/Caddyfile" /etc/caddy/Caddyfile
install -d /etc/systemd/system/caddy.service.d
cat > /etc/systemd/system/caddy.service.d/orion.conf <<EOF
[Service]
Environment=ORION_DOMAIN=$ORION_DOMAIN
Environment=ACME_EMAIL=$ACME_EMAIL
Environment=WEB_UPSTREAM=127.0.0.1:3000
Environment=API_UPSTREAM=127.0.0.1:3001
EOF

say "systemd units"
install -m 0644 "$app"/deploy/systemd/orion-server.service "$app"/deploy/systemd/orion-web.service \
  "$app"/deploy/systemd/orion-backup.service "$app"/deploy/systemd/orion-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable orion-server orion-web orion-backup.timer
systemctl restart caddy

say "First build"
"$app/deploy/systemd/orion-update.sh" || echo "first start is not healthy yet; finish the config below, then: sudo systemctl restart orion-server"
systemctl start orion-backup.timer
swap_now="$(swapon --show=SIZE --noheadings | head -1)"

cat <<EOF

Done. Box: ${mem_mb}MB RAM, swap ${swap_now}.

Next:
  1. sudo nano $etc/orion.env    # OPENROUTER_API_KEY, EXTENSION_IDS; EMBED_PROVIDER=gemma only on 4GB+
     sudo systemctl restart orion-server
  2. DNS: app.$ORION_DOMAIN and api.$ORION_DOMAIN -> this box (A/AAAA). Caddy fetches certificates on first request.
  3. First admin: see "First admin" in docs/deploy.md (scripts/account.ts create ... --admin).
  4. Offsite backups: sudo -u orion rclone config --config $etc/rclone.conf, then set RCLONE_REMOTE in $etc/backup.env
     and test: sudo systemctl start orion-backup && journalctl -u orion-backup -n 50
  5. Turn on disk encryption at the host / volume level (see docs/launch-checklist.md).
EOF
