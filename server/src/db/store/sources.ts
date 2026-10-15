// Sources: every captured page and commit, its screenshot, and which nodes it changed.
import type { ImageStatus, Source, SourceChange, SourceKind, Status } from "@/contract/types";
import { getUser } from "./people";
import { fromBlob, rowVectors, toBlob, type Db, type VectorRow } from "./rows";
import { SOURCE_TEXT_MAX, type NewSource, type NodeChange, type SourceMeta, type StoredSource } from "./types";

const EXCERPT_MAX = 280;

type SourceRow = VectorRow & {
  id: string;
  kind: string;
  ref: string;
  title: string;
  text: string;
  ocr_text: string | null;
  image_status: string | null;
  author_id: string | null;
  has_image: number;
  created_at: string;
};

const SOURCE_COLS = `id, kind, ref, title, text, ocr_text, image_status, author_id, image IS NOT NULL AS has_image, created_at,
  embedding, embed_model, embed_ctx, z, z_version, cluster_id`;

const SOURCE_META_COLS = `id, kind, ref, title, image_status, author_id, image IS NOT NULL AS has_image, created_at,
  embedding, embed_model, embed_ctx, z, z_version, cluster_id`;

function rowToSourceMeta(r: Omit<SourceRow, "text" | "ocr_text">): SourceMeta {
  const hasImage = r.has_image === 1;
  return {
    id: r.id,
    kind: r.kind as SourceKind,
    ref: r.ref,
    title: r.title,
    imageStatus: (r.image_status as ImageStatus | null) ?? (hasImage ? "kept" : "none"),
    authorId: r.author_id,
    createdAt: r.created_at,
    hasImage,
    ...rowVectors(r),
  };
}

function rowToSource(r: SourceRow): StoredSource {
  const hasImage = r.has_image === 1;
  return {
    id: r.id,
    kind: r.kind as SourceKind,
    ref: r.ref,
    title: r.title,
    text: r.text,
    ocrText: r.ocr_text ?? "",
    imageStatus: (r.image_status as ImageStatus | null) ?? (hasImage ? "kept" : "none"),
    authorId: r.author_id,
    createdAt: r.created_at,
    hasImage,
    ...rowVectors(r),
  };
}

type ChangeRow = { node_id: string; label: string; change: string; status_from: string | null; status_to: string };

function rowToChange(r: ChangeRow): SourceChange {
  return {
    nodeId: r.node_id,
    label: r.label,
    change: r.change as SourceChange["change"],
    statusFrom: r.status_from as Status | null,
    statusTo: r.status_to as Status,
  };
}

/** Collapses whitespace and cuts to a card-sized excerpt. */
export function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT_MAX ? `${flat.slice(0, EXCERPT_MAX - 3)}...` : flat;
}

export function saveSource(db: Db, s: NewSource, changes: NodeChange[]): void {
  db.transaction(() => {
    db.prepare(
      `INSERT OR REPLACE INTO sources (id, kind, ref, title, text, ocr_text, image_status, author_id, image, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      s.id,
      s.kind,
      s.ref,
      s.title,
      s.text.slice(0, SOURCE_TEXT_MAX),
      (s.ocrText ?? "").slice(0, SOURCE_TEXT_MAX),
      s.imageStatus ?? (s.image ? "kept" : "none"),
      s.authorId,
      s.image,
      s.createdAt,
    );
    const stmt = db.prepare(`INSERT OR REPLACE INTO source_changes (source_id, node_id, change, status_from, status_to) VALUES (?, ?, ?, ?, ?)`);
    for (const c of changes) stmt.run(s.id, c.nodeId, c.change, c.statusFrom, c.statusTo);
  })();
}

export function getSource(db: Db, id: string): StoredSource | null {
  const row = db.prepare(`SELECT ${SOURCE_COLS} FROM sources WHERE id = ?`).get(id) as SourceRow | undefined;
  return row ? rowToSource(row) : null;
}

/** Full sources by id, in the order given; missing ids are skipped. */
export function getSources(db: Db, ids: string[]): StoredSource[] {
  const out: StoredSource[] = [];
  const stmt = db.prepare(`SELECT ${SOURCE_COLS} FROM sources WHERE id = ?`);
  for (const id of ids) {
    const row = stmt.get(id) as SourceRow | undefined;
    if (row) out.push(rowToSource(row));
  }
  return out;
}

/** The newest source of this kind and ref by this author, if any. */
export function lastSourceBy(db: Db, kind: SourceKind, ref: string, authorId: string): StoredSource | null {
  const row = db
    .prepare(`SELECT ${SOURCE_COLS} FROM sources WHERE ref = ? AND kind = ? AND author_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(ref, kind, authorId) as SourceRow | undefined;
  return row ? rowToSource(row) : null;
}

/** Newest first. `since` is an ISO timestamp; a negative limit means no limit. */
export function listSources(db: Db, since: string | undefined, limit: number): StoredSource[] {
  const rows = since
    ? db.prepare(`SELECT ${SOURCE_COLS} FROM sources WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?`).all(since, limit)
    : db.prepare(`SELECT ${SOURCE_COLS} FROM sources ORDER BY created_at DESC LIMIT ?`).all(limit);
  return (rows as SourceRow[]).map(rowToSource);
}

/** Every source without its text, newest first. */
export function listSourceMeta(db: Db): SourceMeta[] {
  return (db.prepare(`SELECT ${SOURCE_META_COLS} FROM sources ORDER BY created_at DESC`).all() as SourceRow[]).map(rowToSourceMeta);
}

/** Cached plain-text vectors (title + body, no screenshot, no role) used to group similar sources into digests. */
export function plainVectors(db: Db): Map<string, { vec: Float32Array; model: string; hash: string }> {
  const rows = db.prepare("SELECT id, plain_vec, plain_model, plain_hash FROM sources WHERE plain_vec IS NOT NULL").all() as {
    id: string;
    plain_vec: Buffer;
    plain_model: string;
    plain_hash: string;
  }[];
  return new Map(rows.map((r) => [r.id, { vec: fromBlob(r.plain_vec)!, model: r.plain_model, hash: r.plain_hash }]));
}

export function setPlainVectors(db: Db, items: { id: string; vec: Float32Array; model: string; hash: string }[]): void {
  const stmt = db.prepare("UPDATE sources SET plain_vec = ?, plain_model = ?, plain_hash = ? WHERE id = ?");
  db.transaction(() => items.forEach((it) => stmt.run(toBlob(it.vec), it.model, it.hash, it.id)))();
}

/** Who wrote what since `since`, without loading documents: one row per source. */
export function sourceAuthorsSince(db: Db, since: string): { authorId: string | null; createdAt: string }[] {
  return (
    db.prepare("SELECT author_id, created_at FROM sources WHERE created_at >= ? ORDER BY created_at DESC").all(since) as {
      author_id: string | null;
      created_at: string;
    }[]
  ).map((r) => ({ authorId: r.author_id, createdAt: r.created_at }));
}

export function counts(db: Db): { nodes: number; edges: number; sources: number } {
  return db
    .prepare("SELECT (SELECT COUNT(*) FROM nodes) AS nodes, (SELECT COUNT(*) FROM edges) AS edges, (SELECT COUNT(*) FROM sources) AS sources")
    .get() as { nodes: number; edges: number; sources: number };
}

/** Changes whenever an item, its embedding, its cluster, or the edges change. Cheap cache key for projections. */
export function embeddingStamp(db: Db): string {
  const r = db
    .prepare(
      `SELECT (SELECT COUNT(*) || ':' || COUNT(embedding) || ':' || COUNT(z) || ':' || COUNT(cluster_id) || ':' || IFNULL(MAX(updated_at), '') FROM nodes) AS n,
              (SELECT COUNT(*) || ':' || COUNT(embedding) || ':' || COUNT(z) || ':' || COUNT(cluster_id) || ':' || IFNULL(MAX(created_at), '') FROM sources) AS s,
              (SELECT COUNT(*) FROM edges) AS e,
              (SELECT COUNT(*) || ':' || IFNULL(MAX(version), '') FROM clusters) AS c`,
    )
    .get() as { n: string; s: string; e: number; c: string };
  return `${r.n}|${r.s}|${r.e}|${r.c}`;
}

export function sourceImage(db: Db, id: string): Buffer | null {
  const row = db.prepare("SELECT image FROM sources WHERE id = ?").get(id) as { image: Buffer | null } | undefined;
  return row?.image ?? null;
}

export function sourceChanges(db: Db, sourceId: string): SourceChange[] {
  return (
    db
      .prepare(
        `SELECT c.node_id, n.label, c.change, c.status_from, c.status_to FROM source_changes c
         JOIN nodes n ON n.id = c.node_id WHERE c.source_id = ?`,
      )
      .all(sourceId) as ChangeRow[]
  ).map(rowToChange);
}

/** Every source's changes in one query, keyed by source id. */
export function changesBySource(db: Db): Map<string, SourceChange[]> {
  const rows = db
    .prepare(
      `SELECT c.source_id, c.node_id, n.label, c.change, c.status_from, c.status_to FROM source_changes c
       JOIN nodes n ON n.id = c.node_id`,
    )
    .all() as (ChangeRow & { source_id: string })[];
  const out = new Map<string, SourceChange[]>();
  for (const r of rows) {
    const list = out.get(r.source_id) ?? [];
    list.push(rowToChange(r));
    out.set(r.source_id, list);
  }
  return out;
}

/** Source ids behind a node, newest first. */
export function sourceIdsForNode(db: Db, nodeId: string, limit: number): string[] {
  return (
    db
      .prepare(
        `SELECT s.id FROM source_changes c JOIN sources s ON s.id = c.source_id
         WHERE c.node_id = ? ORDER BY s.created_at DESC LIMIT ?`,
      )
      .all(nodeId, limit) as { id: string }[]
  ).map((r) => r.id);
}

/** A new 768d vector invalidates the org-space vector and cluster derived from it. */
export function setSourceEmbedding(db: Db, id: string, vec: Float32Array, model: string, ctx: string | null): void {
  db.prepare("UPDATE sources SET embedding = ?, embed_model = ?, embed_ctx = ?, z = NULL, z_version = NULL, cluster_id = NULL WHERE id = ?").run(
    toBlob(vec),
    model,
    ctx,
    id,
  );
}

/** Swaps in a processed screenshot and clears the vectors so it re-embeds. */
export function replaceSourceImage(db: Db, id: string, image: Buffer, status: ImageStatus): void {
  db.prepare(
    `UPDATE sources SET image = ?, image_status = ?, embedding = NULL, embed_model = NULL, embed_ctx = NULL,
       z = NULL, z_version = NULL, cluster_id = NULL WHERE id = ?`,
  ).run(image, status, id);
}

export function setSourceZ(db: Db, id: string, z: Float32Array, version: string): void {
  db.prepare("UPDATE sources SET z = ?, z_version = ? WHERE id = ?").run(toBlob(z), version, id);
}

/** The API shape: an excerpt instead of the full text, the author's name, and what the source changed. */
export function toPublicSource(db: Db, s: StoredSource): Source {
  const author = s.authorId ? getUser(db, s.authorId) : null;
  return {
    id: s.id,
    kind: s.kind,
    ref: s.ref,
    title: s.title,
    excerpt: excerpt(s.text),
    authorId: s.authorId,
    authorName: author?.name ?? null,
    createdAt: s.createdAt,
    hasImage: s.hasImage,
    changes: sourceChanges(db, s.id),
  };
}
