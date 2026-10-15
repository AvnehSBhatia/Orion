#!/usr/bin/env bash
# Build and (re)start Orion from the checkout in /opt/orion. Run as root.
#   sudo /opt/orion/deploy/systemd/orion-update.sh            # pull the tracked branch and deploy
#   sudo /opt/orion/deploy/systemd/orion-update.sh <git-ref>  # deploy a tag, branch or sha (rollback)
# Each deploy appends "<time> <old sha> -> <new sha>" to /var/lib/orion/deploys.log.
set -euo pipefail

app=/opt/orion
env_file=/etc/orion/orion.env
log=/var/lib/orion/deploys.log
ref="${1:-}"

[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }
as_orion() { sudo -u orion -H "$@"; }

domain="$(grep -E '^ORION_DOMAIN=' "$env_file" | tail -1 | cut -d= -f2- | tr -d "\"' ")"
if [ -z "$domain" ] || [ "$domain" = example.com ]; then
  echo "set ORION_DOMAIN in $env_file" >&2
  exit 1
fi

cd "$app"
old="$(as_orion git rev-parse HEAD)"
as_orion git fetch --tags --prune origin
if [ -n "$ref" ]; then
  as_orion git checkout --detach "$ref"
else
  branch="$(as_orion git rev-parse --abbrev-ref HEAD)"
  if [ "$branch" = HEAD ]; then
    echo "detached HEAD (after a rollback?); pass a ref, e.g. orion-update.sh origin/main" >&2
    exit 1
  fi
  as_orion git pull --ff-only
fi
new="$(as_orion git rev-parse HEAD)"
echo "deploying $old -> $new"

# Build while the old version keeps serving. npm ci replaces node_modules, so there is a short window
# (a minute or two) where a lazily loaded module can fail; the restart below ends it.
as_orion bash -c "cd server && npm ci --no-audit --no-fund && NEXT_TELEMETRY_DISABLED=1 node_modules/.bin/next build"
as_orion bash -c "cd web && npm ci --no-audit --no-fund && NEXT_PUBLIC_ORION_API=https://api.$domain NEXT_TELEMETRY_DISABLED=1 node_modules/.bin/next build"

systemctl restart orion-server orion-web
echo "$(date -u +%FT%TZ) $old -> $new" >> "$log"

for i in $(seq 1 60); do
  if curl -fsS -m 5 http://127.0.0.1:3001/api/health >/dev/null; then
    echo "healthy after $((i * 2))s: $new"
    exit 0
  fi
  sleep 2
done
echo "server not healthy after 2 minutes. Logs: journalctl -u orion-server -n 200" >&2
echo "roll back: sudo $0 $old" >&2
exit 1
