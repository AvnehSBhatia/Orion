#!/usr/bin/env bash
# Orion backup: online SQLite copies via server/scripts/backup.ts, local retention, integrity check,
# offsite sync with rclone, offsite retention, optional dead-man's-switch ping.
#
# Runs from the orion-backup.timer (systemd install) or from cron on a Docker host:
#   15 3 * * * ORION_BACKUP_MODE=docker /opt/orion/deploy/backup/orion-backup.sh >> /var/log/orion-backup.log 2>&1
#
# Settings (environment, or /etc/orion/backup.env for the systemd timer):
#   ORION_BACKUP_MODE   systemd (default) | docker
#   BACKUP_DIR          where backup.ts writes (systemd default /var/lib/orion/backups; docker: the host dir
#                       mounted at /backups, default <repo>/deploy/backups)
#   BACKUP_KEEP_DAYS    local retention in days (default 7)
#   RCLONE_REMOTE       rclone destination, e.g. "b2:acme-orion-backups/prod" or "orion-crypt:prod".
#                       Empty skips the offsite copy (not recommended).
#   RCLONE_CONFIG       rclone config file (systemd default /etc/orion/rclone.conf)
#   RCLONE_KEEP_DAYS    offsite retention in days (default 35; 0 keeps everything, e.g. when the bucket
#                       has its own lifecycle rule or object lock)
#   HEALTHCHECK_URL     optional URL pinged on success (and <url>/fail on failure), e.g. healthchecks.io
#   ORION_BACKUP_CMD    override the backup command entirely (gets BACKUP_DIR in the environment)
#   ORION_SERVER_DIR    server checkout for systemd mode (default /opt/orion/server)
#   ORION_ENV_FILE      env file for systemd mode (default /etc/orion/orion.env)
#   COMPOSE_FILE        compose file for docker mode (default <repo>/deploy/docker-compose.yml)
set -euo pipefail
umask 077

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"

mode="${ORION_BACKUP_MODE:-systemd}"
keep_days="${BACKUP_KEEP_DAYS:-7}"
remote="${RCLONE_REMOTE:-}"
remote_keep_days="${RCLONE_KEEP_DAYS:-35}"
server_dir="${ORION_SERVER_DIR:-/opt/orion/server}"
env_file="${ORION_ENV_FILE:-/etc/orion/orion.env}"
compose_file="${COMPOSE_FILE:-$repo/deploy/docker-compose.yml}"
if [ "$mode" = docker ]; then
  backup_dir="${BACKUP_DIR:-$repo/deploy/backups}"
else
  backup_dir="${BACKUP_DIR:-/var/lib/orion/backups}"
  export RCLONE_CONFIG="${RCLONE_CONFIG:-/etc/orion/rclone.conf}"
fi

log() { printf '%s orion-backup: %s\n' "$(date -u +%FT%TZ)" "$*"; }
ping_hc() { [ -n "${HEALTHCHECK_URL:-}" ] && curl -fsS -m 10 --retry 3 "$HEALTHCHECK_URL$1" >/dev/null || true; }
on_error() { log "FAILED (line $1)"; ping_hc /fail; }
trap 'on_error $LINENO' ERR

mkdir -p "$backup_dir"
marker="$(mktemp)"
trap 'rm -f "$marker"' EXIT
ping_hc /start

# 1. Online backup (safe while the server is writing; never cp a live WAL database).
log "writing backup into $backup_dir ($mode)"
if [ -n "${ORION_BACKUP_CMD:-}" ]; then
  BACKUP_DIR="$backup_dir" bash -c "$ORION_BACKUP_CMD"
elif [ "$mode" = docker ]; then
  docker compose -f "$compose_file" exec -T server node_modules/.bin/tsx scripts/backup.ts --out /backups
else
  (cd "$server_dir" && node_modules/.bin/tsx --env-file-if-exists="$env_file" scripts/backup.ts --out "$backup_dir")
fi

# 2. Check what was just written: at least one database, and every new database passes integrity_check.
mapfile -t new_dbs < <(find "$backup_dir" -type f -name '*.db' -newer "$marker")
if [ "${#new_dbs[@]}" -eq 0 ]; then
  log "no new .db files under $backup_dir; backup.ts wrote nothing"
  false
fi
if command -v sqlite3 >/dev/null; then
  for db in "${new_dbs[@]}"; do
    result="$(sqlite3 -readonly "$db" 'PRAGMA integrity_check;' 2>&1 | head -1)"
    if [ "$result" != ok ]; then
      log "integrity_check failed for $db: $result"
      false
    fi
  done
  log "integrity ok for ${#new_dbs[@]} database(s)"
else
  log "sqlite3 not installed; skipped integrity check"
fi

# 3. Local retention.
find "$backup_dir" -mindepth 1 -maxdepth 1 -mtime +"$keep_days" -exec rm -rf {} +

# 4. Offsite.
if [ -n "$remote" ]; then
  log "syncing to $remote"
  rclone copy "$backup_dir" "$remote" --transfers 4 --checksum --stats-one-line --stats 0
  if [ "$remote_keep_days" != 0 ]; then
    rclone delete "$remote" --min-age "${remote_keep_days}d"
    rclone rmdirs "$remote" --leave-root || true
  fi
else
  log "RCLONE_REMOTE is empty; backups stay on this box only"
fi

log "done ($(du -sh "$backup_dir" | cut -f1) on disk)"
ping_hc ""
