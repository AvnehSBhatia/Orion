import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { backupAll, stampOf } from "./backup";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orion-backup-"));
  const dataDir = path.join(root, "data");
  fs.mkdirSync(path.join(dataDir, "orgs"), { recursive: true });
  for (const name of ["orgs/acme.db", "orgs/beta.db", "auth.db"]) {
    const db = new Database(path.join(dataDir, name));
    db.pragma("journal_mode = WAL");
    db.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('hello')");
    // Left open on purpose: the backup runs against live WAL databases.
  }
  return { root, dataDir, outDir: path.join(root, "backups") };
}

describe("backupAll", () => {
  it("copies every org db and auth.db into a timestamped dir with a manifest", async () => {
    const { dataDir, outDir } = fixture();
    const now = new Date("2026-10-14T12:00:00Z");
    const r = await backupAll({ dataDir, outDir, keep: 3, now });
    expect(r.dir).toBe(path.join(outDir, stampOf(now)));
    expect(r.files.map((f) => f.path)).toEqual(["orgs/acme.db", "orgs/beta.db", "auth.db"]);
    const copy = new Database(path.join(r.dir, "orgs/acme.db"), { readonly: true });
    expect(copy.prepare("SELECT v FROM t").get()).toEqual({ v: "hello" });
    copy.close();
    expect(JSON.parse(fs.readFileSync(path.join(r.dir, "manifest.json"), "utf8")).files).toHaveLength(3);
    expect(fs.readdirSync(outDir).some((e) => e.endsWith(".partial"))).toBe(false);
  });

  it("keeps only the newest N backups", async () => {
    const { dataDir, outDir } = fixture();
    for (let h = 0; h < 5; h++) await backupAll({ dataDir, outDir, keep: 2, now: new Date(Date.UTC(2026, 9, 14, h)) });
    expect(fs.readdirSync(outDir).sort()).toEqual([stampOf(new Date(Date.UTC(2026, 9, 14, 3))), stampOf(new Date(Date.UTC(2026, 9, 14, 4)))]);
  });

  it("saves the good databases when one is corrupt, and keeps the old backups", async () => {
    const { dataDir, outDir } = fixture();
    await backupAll({ dataDir, outDir, keep: 1, now: new Date(Date.UTC(2026, 9, 14, 1)) });
    fs.writeFileSync(path.join(dataDir, "orgs", "broken.db"), "this is not sqlite".repeat(100));
    const r = await backupAll({ dataDir, outDir, keep: 1, now: new Date(Date.UTC(2026, 9, 14, 2)) });
    expect(r.failed.map((f) => f.path)).toEqual(["orgs/broken.db"]);
    expect(r.files.map((f) => f.path)).toEqual(["orgs/acme.db", "orgs/beta.db", "auth.db"]);
    expect(r.removed).toEqual([]);
    expect(fs.readdirSync(outDir)).toHaveLength(2);
  });
});
