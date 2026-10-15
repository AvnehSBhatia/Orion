// Online backups of every org database and auth.db with SQLite's backup API, safe while the server is writing
// (copying a live WAL database with cp is not).
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type BackupResult = {
  dir: string;
  files: { path: string; bytes: number }[];
  /** Databases that could not be copied (for example a corrupt file); the rest are still backed up. */
  failed: { path: string; error: string }[];
  removed: string[];
};

const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;
export const stampOf = (d: Date) => d.toISOString().replace(/[:.]/g, "-");

/** The databases to back up, relative to DATA_DIR: orgs/*.db and auth.db. */
export function databasesIn(dataDir: string): string[] {
  const orgs = path.join(dataDir, "orgs");
  const out = fs.existsSync(orgs)
    ? fs
        .readdirSync(orgs)
        .filter((f) => f.endsWith(".db"))
        .sort()
        .map((f) => path.join("orgs", f))
    : [];
  if (fs.existsSync(path.join(dataDir, "auth.db"))) out.push("auth.db");
  return out;
}

async function copyOne(src: string, dest: string): Promise<void> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const db = new Database(src, { readonly: true, fileMustExist: true });
  try {
    await db.backup(dest);
  } finally {
    db.close();
  }
  const check = new Database(dest, { readonly: true });
  try {
    const ok = check.pragma("quick_check", { simple: true });
    if (ok !== "ok") throw new Error(`backup of ${src} failed its integrity check: ${String(ok)}`);
  } finally {
    check.close();
  }
}

/**
 * Copies every database into `${outDir}/<UTC timestamp>/` (written as `.partial` and renamed when complete, so a
 * crashed run never looks like a good backup), writes a manifest, and keeps only the newest `keep` backups.
 * A database that fails to copy is listed in `failed` and the others are still saved; old backups are then kept,
 * so a broken file never rotates the last good copy of it away.
 */
export async function backupAll({ dataDir, outDir, keep, now = new Date() }: { dataDir: string; outDir: string; keep: number; now?: Date }): Promise<BackupResult> {
  const stamp = stampOf(now);
  const partial = path.join(outDir, `${stamp}.partial`);
  const final = path.join(outDir, stamp);
  fs.mkdirSync(partial, { recursive: true, mode: 0o700 });
  const files: BackupResult["files"] = [];
  const failed: BackupResult["failed"] = [];
  try {
    for (const rel of databasesIn(dataDir)) {
      const dest = path.join(partial, rel);
      try {
        await copyOne(path.join(dataDir, rel), dest);
        files.push({ path: rel, bytes: fs.statSync(dest).size });
      } catch (err) {
        fs.rmSync(dest, { force: true });
        failed.push({ path: rel, error: (err as Error).message });
      }
    }
    fs.writeFileSync(
      path.join(partial, "manifest.json"),
      JSON.stringify({ createdAt: now.toISOString(), dataDir: path.resolve(dataDir), files, failed }, null, 2),
    );
    fs.renameSync(partial, final);
  } catch (err) {
    fs.rmSync(partial, { recursive: true, force: true });
    throw err;
  }

  const removed: string[] = [];
  const entries = fs.readdirSync(outDir);
  const complete = entries.filter((e) => STAMP.test(e)).sort();
  for (const old of failed.length ? [] : complete.slice(0, Math.max(0, complete.length - Math.max(1, keep)))) {
    fs.rmSync(path.join(outDir, old), { recursive: true, force: true });
    removed.push(old);
  }
  // Leftovers of crashed runs older than a day.
  for (const e of entries.filter((e) => e.endsWith(".partial") && e !== `${stamp}.partial`)) {
    const at = Date.parse(e.replace(".partial", "").replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z"));
    if (!Number.isNaN(at) && now.getTime() - at > 86_400_000) fs.rmSync(path.join(outDir, e), { recursive: true, force: true });
  }
  return { dir: final, files, failed, removed };
}
