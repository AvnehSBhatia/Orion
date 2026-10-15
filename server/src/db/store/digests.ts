// Digests (several similar sources merged into one text) and the per-source summaries that feed them.
import type { ImageStatus, Source, SourceMember } from "@/contract/types";
import { getUser } from "./people";
import { fromBlob, toBlob, type Db } from "./rows";
import { excerpt, getSource, sourceChanges, toPublicSource } from "./sources";
import type { StoredDigest, StoredSummary } from "./types";

type DigestRow = {
  id: string;
  title: string;
  text: string;
  members: string;
  members_key: string;
  cluster_id: string | null;
  fidelity: number;
  newest_at: string;
  created_at: string;
  embedding: Buffer | null;
  embed_model: string | null;
};

function rowToDigest(r: DigestRow): StoredDigest {
  return {
    id: r.id,
    title: r.title,
    text: r.text,
    members: JSON.parse(r.members) as string[],
    membersKey: r.members_key,
    clusterId: r.cluster_id,
    fidelity: r.fidelity,
    newestAt: r.newest_at,
    createdAt: r.created_at,
    embedding: fromBlob(r.embedding),
    embedModel: r.embed_model,
  };
}

export function listDigests(db: Db): StoredDigest[] {
  return (db.prepare("SELECT * FROM digests ORDER BY newest_at DESC").all() as DigestRow[]).map(rowToDigest);
}

export function getDigest(db: Db, id: string): StoredDigest | null {
  const row = db.prepare("SELECT * FROM digests WHERE id = ?").get(id) as DigestRow | undefined;
  return row ? rowToDigest(row) : null;
}

export function saveDigest(db: Db, d: StoredDigest): void {
  db.prepare(
    `INSERT OR REPLACE INTO digests (id, title, text, members, members_key, cluster_id, fidelity, newest_at, created_at,
       embedding, embed_model) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    d.id,
    d.title,
    d.text,
    JSON.stringify(d.members),
    d.membersKey,
    d.clusterId,
    d.fidelity,
    d.newestAt,
    d.createdAt,
    toBlob(d.embedding),
    d.embedModel,
  );
}

export function deleteDigests(db: Db, ids: string[]): void {
  const stmt = db.prepare("DELETE FROM digests WHERE id = ?");
  db.transaction(() => ids.forEach((id) => stmt.run(id)))();
}

export function getSummary(db: Db, sourceId: string): StoredSummary | null {
  const r = db.prepare("SELECT * FROM summaries WHERE source_id = ?").get(sourceId) as
    | { source_id: string; text: string; text_hash: string; fidelity: number }
    | undefined;
  return r ? { sourceId: r.source_id, text: r.text, textHash: r.text_hash, fidelity: r.fidelity } : null;
}

export function saveSummary(db: Db, s: StoredSummary): void {
  db.prepare("INSERT OR REPLACE INTO summaries (source_id, text, text_hash, fidelity) VALUES (?, ?, ?, ?)").run(
    s.sourceId,
    s.text,
    s.textHash,
    s.fidelity,
  );
}

/** A digest in the same public shape as a source, with the documents it merges. */
export function toPublicDigest(db: Db, d: StoredDigest): Source {
  const members: SourceMember[] = d.members.flatMap((id) => {
    const s = getSource(db, id);
    if (!s) return [];
    const author = s.authorId ? getUser(db, s.authorId) : null;
    return [{ id: s.id, title: s.title, ref: s.ref, authorName: author?.name ?? null, createdAt: s.createdAt }];
  });
  return {
    id: d.id,
    kind: "digest",
    ref: members.map((m) => m.ref).join(" "),
    title: d.title,
    excerpt: excerpt(d.text),
    authorId: null,
    authorName: [...new Set(members.flatMap((m) => m.authorName ?? []))].join(", ") || null,
    createdAt: d.newestAt,
    hasImage: false,
    changes: [...new Map(d.members.flatMap((id) => sourceChanges(db, id)).map((c) => [c.nodeId, c])).values()],
    members,
  };
}

/** Full text of a document or digest by id. `ocrText` is what was read off a kept screenshot. */
export function readDocument(db: Db, id: string): { source: Source; text: string; ocrText: string; imageStatus: ImageStatus } | null {
  const s = getSource(db, id);
  if (s) return { source: toPublicSource(db, s), text: s.text, ocrText: s.ocrText, imageStatus: s.imageStatus };
  const d = getDigest(db, id);
  return d ? { source: toPublicDigest(db, d), text: d.text, ocrText: "", imageStatus: "none" } : null;
}
