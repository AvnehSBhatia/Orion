// Retention: what an org keeps and for how long. Run hourly by the background scheduler, one org at a time.
import type { Store } from "@/db/store";
import { clearOldSnippets } from "@/mac/drafts";
import { clearOldMacDocText } from "@/mac/workBlocks";
import { getOrgSettings } from "@/orgs/settings";

const DAY = 86_400_000;
const GB = 1024 ** 3;
/** Rows per write transaction, so a large purge never holds the write lock for long. */
const CHUNK = 500;

export const retentionEnv = {
  /** MAX_SCREENSHOT_GB_PER_ORG (default 5): oldest screenshots are removed past this. 0 means no cap. */
  get maxScreenshotBytes(): number {
    const raw = process.env.MAX_SCREENSHOT_GB_PER_ORG;
    const n = raw === undefined || raw === "" ? 5 : Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n * GB) : n === 0 ? 0 : 5 * GB;
  },
  /** Free pages, as a share of the file, that justify a full VACUUM on a file not yet in incremental mode. */
  get vacuumFreeShare(): number {
    const n = Number(process.env.VACUUM_FREE_SHARE);
    return Number.isFinite(n) && n > 0 && n < 1 ? n : 0.25;
  },
};

export type RetentionReport = {
  documentsDeleted: number;
  screenshotsExpired: number;
  screenshotsEvicted: number;
  digestsDeleted: number;
  vacuum: "none" | "incremental" | "full";
  ms: number;
};

function inChunks(store: Store, ids: string[], run: (id: string) => void): void {
  for (let i = 0; i < ids.length; i += CHUNK) store.transaction(() => ids.slice(i, i + CHUNK).forEach(run));
}

/**
 * Deletes documents older than `retentionDays`. Graph nodes they produced stay (they are the org's shared record);
 * the document's text, screenshot, vectors, summary, labels and its source_changes rows go, and so do digests whose
 * every member is gone or older than the cutoff (their text is a summary of the deleted documents).
 */
export function deleteOldDocuments(store: Store, retentionDays: number, now = Date.now()): { documents: number; digests: number } {
  if (!(retentionDays > 0)) return { documents: 0, digests: 0 };
  const cutoff = new Date(now - retentionDays * DAY).toISOString();
  const ids = (store.db.prepare("SELECT id FROM sources WHERE created_at < ?").all(cutoff) as { id: string }[]).map((r) => r.id);
  const delChanges = store.db.prepare("DELETE FROM source_changes WHERE source_id = ?");
  const delSummary = store.db.prepare("DELETE FROM summaries WHERE source_id = ?");
  const delFacet = store.db.prepare("DELETE FROM facets WHERE item_kind = 'source' AND item_id = ?");
  const delSource = store.db.prepare("DELETE FROM sources WHERE id = ?");
  inChunks(store, ids, (id) => {
    delChanges.run(id);
    delSummary.run(id);
    delFacet.run(id);
    delSource.run(id);
  });

  const exists = store.db.prepare("SELECT 1 FROM sources WHERE id = ?");
  const digests = store.db.prepare("SELECT id, members, newest_at FROM digests").all() as { id: string; members: string; newest_at: string }[];
  const stale = digests
    .filter((d) => d.newest_at < cutoff || (JSON.parse(d.members) as string[]).every((m) => !exists.get(m)))
    .map((d) => d.id);
  if (stale.length) store.deleteDigests(stale);
  return { documents: ids.length, digests: stale.length };
}

/** Removes screenshots from documents older than `screenshotRetentionDays`; their text stays. */
export function expireScreenshots(store: Store, screenshotRetentionDays: number, now = Date.now()): number {
  if (!(screenshotRetentionDays > 0)) return 0;
  const cutoff = new Date(now - screenshotRetentionDays * DAY).toISOString();
  return store.db.prepare("UPDATE sources SET image = NULL, image_status = 'none' WHERE image IS NOT NULL AND created_at < ?").run(cutoff).changes;
}

/** Keeps an org's screenshots under `maxBytes` by removing the oldest first. 0 means no cap. */
export function capScreenshots(store: Store, maxBytes = retentionEnv.maxScreenshotBytes): number {
  if (!(maxBytes > 0)) return 0;
  const total = (store.db.prepare("SELECT IFNULL(SUM(length(image)), 0) AS n FROM sources WHERE image IS NOT NULL").get() as { n: number }).n;
  if (total <= maxBytes) return 0;
  const over = total - maxBytes;
  const ids: string[] = [];
  let freed = 0;
  for (const r of store.db.prepare("SELECT id, length(image) AS n FROM sources WHERE image IS NOT NULL ORDER BY created_at").iterate() as Iterable<{ id: string; n: number }>) {
    ids.push(r.id);
    freed += r.n;
    if (freed >= over) break;
  }
  const clear = store.db.prepare("UPDATE sources SET image = NULL, image_status = 'none' WHERE id = ?");
  inChunks(store, ids, (id) => clear.run(id));
  return ids.length;
}

/**
 * Gives freed pages back to the disk. A file in incremental auto-vacuum mode just runs incremental_vacuum. Any other
 * file is converted (auto_vacuum = INCREMENTAL, then one full VACUUM) once its free pages pass `vacuumFreeShare`;
 * a full VACUUM rewrites the file and needs as much free disk again, which is why it only happens once.
 */
export function reclaimSpace(store: Store): RetentionReport["vacuum"] {
  const db = store.db;
  const pages = db.pragma("page_count", { simple: true }) as number;
  const free = db.pragma("freelist_count", { simple: true }) as number;
  if (!free) return "none";
  if ((db.pragma("auto_vacuum", { simple: true }) as number) === 2) {
    db.pragma("incremental_vacuum");
    return "incremental";
  }
  if (free / Math.max(1, pages) < retentionEnv.vacuumFreeShare) return "none";
  db.pragma("auto_vacuum = INCREMENTAL");
  db.exec("VACUUM");
  return "full";
}

/** One retention pass over an org with its current settings (0 days keeps forever). */
export function runRetention(store: Store, now = Date.now()): RetentionReport {
  const t = performance.now();
  const settings = getOrgSettings(store);
  const { documents, digests } = deleteOldDocuments(store, settings.retentionDays, now);
  const screenshotsExpired = expireScreenshots(store, settings.screenshotRetentionDays, now);
  const screenshotsEvicted = capScreenshots(store);
  clearOldSnippets(store, settings.snippetRetentionDays, now);
  // The Orion document made from each Mac block holds the same text, so it goes at the same time.
  if (settings.snippetRetentionDays > 0) clearOldMacDocText(store, new Date(now - settings.snippetRetentionDays * 86_400_000).toISOString());
  const vacuum = documents || digests || screenshotsExpired || screenshotsEvicted ? reclaimSpace(store) : "none";
  return { documentsDeleted: documents, screenshotsExpired, screenshotsEvicted, digestsDeleted: digests, vacuum, ms: Math.round(performance.now() - t) };
}
