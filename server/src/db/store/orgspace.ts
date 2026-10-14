// The org space: trained compressors, area and use labels (facets), and the clusters built from them.
import { fromBlob, toBlob, type Db } from "./rows";
import type { Facet, StoredCluster, StoredCompressor } from "./types";

function compressorWhere(db: Db, where: string): StoredCompressor | null {
  const row = db.prepare(`SELECT * FROM compressors WHERE ${where} ORDER BY created_at DESC, rowid DESC LIMIT 1`).get() as
    | { id: string; kind: string; weights: Buffer; metrics: string | null; created_at: string }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind as StoredCompressor["kind"],
    weights: fromBlob(row.weights)!,
    metrics: row.metrics ? JSON.parse(row.metrics) : null,
    createdAt: row.created_at,
  };
}

export function activeCompressor(db: Db): StoredCompressor | null {
  return compressorWhere(db, "active = 1");
}

/** Most recent training attempt, adopted or not. */
export function latestCompressor(db: Db): StoredCompressor | null {
  return compressorWhere(db, "1 = 1");
}

/** Stores a compressor; when `activate` is set it becomes the only active one. */
export function saveCompressor(db: Db, c: Omit<StoredCompressor, "createdAt">, activate: boolean): void {
  db.transaction(() => {
    if (activate) db.exec("UPDATE compressors SET active = 0");
    db.prepare(
      `INSERT OR REPLACE INTO compressors (id, kind, weights, metrics, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(c.id, c.kind, toBlob(c.weights), JSON.stringify(c.metrics), activate ? 1 : 0, new Date().toISOString());
  })();
}

export function listFacets(db: Db): Facet[] {
  return (
    db.prepare("SELECT item_kind, item_id, area, use, text_hash FROM facets").all() as {
      item_kind: Facet["itemKind"];
      item_id: string;
      area: string;
      use: string;
      text_hash: string;
    }[]
  ).map((r) => ({ itemKind: r.item_kind, itemId: r.item_id, area: r.area, use: r.use, textHash: r.text_hash }));
}

export function saveFacets(db: Db, facets: Facet[]): void {
  const stmt = db.prepare(`INSERT OR REPLACE INTO facets (item_kind, item_id, area, use, text_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
  const now = new Date().toISOString();
  db.transaction(() => facets.forEach((f) => stmt.run(f.itemKind, f.itemId, f.area, f.use, f.textHash, now)))();
}

/** Clusters whose centroids live in the space of compressor `version`. */
export function listClusters(db: Db, version?: string): StoredCluster[] {
  const rows = (
    version
      ? db.prepare("SELECT * FROM clusters WHERE version = ? ORDER BY size DESC, label").all(version)
      : db.prepare("SELECT * FROM clusters ORDER BY size DESC, label").all()
  ) as { id: string; label: string; centroid: Buffer; size: number; version: string }[];
  return rows.map((r) => ({ id: r.id, label: r.label, centroid: fromBlob(r.centroid)!, size: r.size, version: r.version }));
}

export function setClusterOf(db: Db, kind: "node" | "source", id: string, clusterId: string | null): void {
  db.prepare(`UPDATE ${kind === "node" ? "nodes" : "sources"} SET cluster_id = ? WHERE id = ?`).run(clusterId, id);
}

/** Replaces every cluster and every item's assignment in one transaction. */
export function replaceClusters(db: Db, clusters: StoredCluster[], assign: { kind: "node" | "source"; id: string; clusterId: string | null }[]): void {
  db.transaction(() => {
    db.exec("DELETE FROM clusters; UPDATE nodes SET cluster_id = NULL; UPDATE sources SET cluster_id = NULL;");
    const stmt = db.prepare("INSERT INTO clusters (id, label, centroid, size, version) VALUES (?, ?, ?, ?, ?)");
    for (const c of clusters) stmt.run(c.id, c.label, toBlob(c.centroid), c.size, c.version);
    for (const a of assign) setClusterOf(db, a.kind, a.id, a.clusterId);
  })();
}
