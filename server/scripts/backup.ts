// Online backup of every org database and auth.db into a timestamped directory, safe while the server runs.
// Keeps the newest N backups. Shipping them off the box is up to the operator (rsync, restic, rclone, S3 sync).
//
// Usage:
//   npm run backup                                  into $BACKUP_DIR (default: ./backups), keep $BACKUP_KEEP (14)
//   npm run backup -- --dir /var/backups/orion --keep 30
//
// Restore: stop the server, copy <backup>/orgs/*.db into $DATA_DIR/orgs/ and <backup>/auth.db into $DATA_DIR/,
// remove any stale -wal and -shm files next to them, and start the server.

import path from "node:path";
import { parseArgs } from "node:util";
import { config } from "@/config";
import { backupAll } from "@/jobs/backup";

const { values } = parseArgs({
  options: { dir: { type: "string" }, keep: { type: "string" } },
});

const outDir = path.resolve(values.dir ?? process.env.BACKUP_DIR ?? "backups");
const keep = Number(values.keep ?? process.env.BACKUP_KEEP ?? 14);
if (!Number.isInteger(keep) || keep < 1) {
  console.error("--keep must be a whole number of at least 1");
  process.exit(1);
}

try {
  const t = performance.now();
  const r = await backupAll({ dataDir: config.dataDir, outDir, keep });
  const bytes = r.files.reduce((n, f) => n + f.bytes, 0);
  const line = { dir: r.dir, databases: r.files.length, bytes, failed: r.failed, removed: r.removed, ms: Math.round(performance.now() - t) };
  // Exit 1 when any database failed, so a cron or systemd timer alerts; the others were still saved.
  if (r.failed.length) {
    console.error(JSON.stringify({ msg: "backup incomplete", ...line }));
    process.exit(1);
  }
  console.log(JSON.stringify({ msg: "backup complete", ...line }));
  process.exit(0);
} catch (err) {
  console.error(JSON.stringify({ msg: "backup failed", error: (err as Error).message }));
  process.exit(1);
}
