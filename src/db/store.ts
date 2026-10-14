import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type {
  DashboardSpec,
  Domain,
  Edge,
  NodeType,
  Org,
  PublicNode,
  ReadLink,
  Relation,
  ImageStatus,
  Source,
  SourceChange,
  SourceKind,
  SourceMember,
  Status,
  User,
} from "@/contract/types";
import { LABEL_MAX, SUMMARY_MAX, clamp, normalizeLabel, slugify } from "@/lib/text";

/** Every embedded item carries its model, a hash of the role context it was embedded with, and its org-space projection. */
type Vectors = {
  embedding: Float32Array | null;
  embedModel: string | null;
  embedCtx: string | null;
  /** 64d org-space embedding from the active compressor. */
  z: Float32Array | null;
  zVersion: string | null;
  clusterId: string | null;
};

export type StoredNode = PublicNode & Vectors & { key: string };

export type StoredUser = User & {
  seedVec: Float32Array | null;
  seedModel: string | null;
  userVec: Float32Array | null;
  ranked: string[] | null;
  /** Packed Gravity, see src/pseudo/gravity.ts. */
  gravity: Float32Array | null;
  gravityVersion: string | null;
};

/** A captured page or a commit: the raw document behind graph changes. */
export type StoredSource = Vectors & {
  id: string;
  kind: SourceKind;
  ref: string;
  title: string;
  text: string;
  /** Text read off the screenshot. The chat model is text only, so this is how it sees the image. */
  ocrText: string;
  imageStatus: ImageStatus;
  authorId: string | null;
  createdAt: string;
  hasImage: boolean;
};

export type NewSource = Omit<StoredSource, keyof Vectors | "hasImage" | "ocrText" | "imageStatus"> & {
  image: Buffer | null;
  ocrText?: string;
  imageStatus?: ImageStatus;
};

/** Area and use of one node or source, as labeled by the org model. */
export type Facet = { itemId: string; itemKind: "node" | "source"; area: string; use: string; textHash: string };

/** A named region of the org space. `version` is the compressor id its centroid lives in. */
export type StoredCluster = { id: string; label: string; centroid: Float32Array; size: number; version: string };

/** Several similar sources merged into one short text, with the fidelity it passed. */
export type StoredDigest = {
  id: string;
  title: string;
  text: string;
  members: string[];
  membersKey: string;
  clusterId: string | null;
  fidelity: number;
  newestAt: string;
  createdAt: string;
  embedding: Float32Array | null;
  embedModel: string | null;
};

export type StoredSummary = { sourceId: string; text: string; textHash: string; fidelity: number };

export const SOURCE_TEXT_MAX = 8_000;
const EXCERPT_MAX = 280;

export type StoredCompressor = {
  id: string;
  kind: "mrl" | "trained";
  weights: Float32Array;
  metrics: unknown;
  createdAt: string;
};

/** A node as extracted by the model, before it has an id or provenance. */
export type ExtractedNode = {
  label: string;
  type: NodeType;
  domain: Domain;
  summary: string;
  todo: string | null;
  readLinks: ReadLink[];
  owner: string | null;
  status: Status;
  /** null keeps the stored value. Only code ingest decides what sales can mention. */
  sellable: boolean | null;
};

/** Edge endpoints are labels (or ids) as the model wrote them, resolved at upsert time. */
export type ExtractedEdge = { source: string; target: string; relation: Relation };

export type GraphUpdate = { nodes: ExtractedNode[]; edges: ExtractedEdge[] };

export type Provenance = { sourceKind: SourceKind; sourceRef: string; now?: string };

export function nodeKey(type: NodeType, label: string): string {
  return `${type}:${normalizeLabel(label)}`;
}

export function sourceId(kind: SourceKind, ref: string, createdAt: string): string {
  return `src-${createHash("sha1").update(`${kind}\n${ref}\n${createdAt}`).digest("hex").slice(0, 12)}`;
}

export function edgeId(source: string, relation: Relation, target: string): string {
  return `${source}__${relation}__${target}`;
}

export function toPublicNode(node: StoredNode): PublicNode {
  const { key: _k, embedding: _e, embedModel: _m, embedCtx: _c, z: _z, zVersion: _v, clusterId: _cl, ...rest } = node;
  return rest;
}

export function textHash(...parts: (string | null | undefined)[]): string {
  return createHash("sha1").update(parts.map((p) => p ?? "").join("\n")).digest("hex").slice(0, 12);
}

export type NodeChange = Omit<SourceChange, "label">;

export function toPublicUser(user: StoredUser): User {
  return { id: user.id, name: user.name, role: user.role, teamDescription: user.teamDescription };
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  type TEXT NOT NULL,
  domain TEXT NOT NULL,
  summary TEXT NOT NULL,
  todo TEXT,
  read_links TEXT NOT NULL DEFAULT '[]',
  owner TEXT,
  status TEXT NOT NULL,
  sellable INTEGER NOT NULL DEFAULT 0,
  source_kind TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  embedding BLOB,
  embed_model TEXT
);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  relation TEXT NOT NULL,
  source_ref TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS org (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  websites TEXT NOT NULL DEFAULT '[]',
  context TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  team_description TEXT NOT NULL,
  seed_vec BLOB,
  seed_model TEXT,
  user_vec BLOB,
  ranked TEXT
);

CREATE TABLE IF NOT EXISTS compressors (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  weights BLOB NOT NULL,
  metrics TEXT,
  active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS touches (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, node_id)
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  author_id TEXT,
  image BLOB,
  created_at TEXT NOT NULL,
  embedding BLOB,
  embed_model TEXT,
  z BLOB,
  z_version TEXT
);
CREATE INDEX IF NOT EXISTS sources_created ON sources(created_at);
CREATE INDEX IF NOT EXISTS sources_ref ON sources(ref, created_at);

CREATE TABLE IF NOT EXISTS source_changes (
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  change TEXT NOT NULL,
  status_from TEXT,
  status_to TEXT NOT NULL,
  PRIMARY KEY (source_id, node_id)
);
CREATE INDEX IF NOT EXISTS source_changes_node ON source_changes(node_id);

CREATE TABLE IF NOT EXISTS facets (
  item_kind TEXT NOT NULL,
  item_id TEXT NOT NULL,
  area TEXT NOT NULL,
  use TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (item_kind, item_id)
);

CREATE TABLE IF NOT EXISTS clusters (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  centroid BLOB NOT NULL,
  size INTEGER NOT NULL,
  version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS digests (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  members TEXT NOT NULL,
  members_key TEXT NOT NULL,
  cluster_id TEXT,
  fidelity REAL NOT NULL,
  newest_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  embedding BLOB,
  embed_model TEXT
);

CREATE TABLE IF NOT EXISTS dashboards (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  spec TEXT NOT NULL,
  origin TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS summaries (
  source_id TEXT PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  fidelity REAL NOT NULL
);
`;

type VectorRow = {
  embedding: Buffer | null;
  embed_model: string | null;
  embed_ctx: string | null;
  z: Buffer | null;
  z_version: string | null;
  cluster_id: string | null;
};

const NO_VECTORS: Vectors = { embedding: null, embedModel: null, embedCtx: null, z: null, zVersion: null, clusterId: null };

function rowVectors(r: VectorRow): Vectors {
  return {
    embedding: fromBlob(r.embedding),
    embedModel: r.embed_model,
    embedCtx: r.embed_ctx,
    z: fromBlob(r.z),
    zVersion: r.z_version,
    clusterId: r.cluster_id,
  };
}

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

type NodeRow = VectorRow & {
  id: string;
  key: string;
  label: string;
  type: string;
  domain: string;
  summary: string;
  todo: string | null;
  read_links: string;
  owner: string | null;
  status: string;
  sellable: number;
  source_kind: string;
  source_ref: string;
  updated_at: string;
};

type UserRow = {
  id: string;
  name: string;
  role: string;
  team_description: string;
  seed_vec: Buffer | null;
  seed_model: string | null;
  user_vec: Buffer | null;
  ranked: string | null;
  gravity: Buffer | null;
  gravity_version: string | null;
};

type EdgeRow = { id: string; source: string; target: string; relation: string; source_ref: string };

function toBlob(vec: Float32Array | null): Buffer | null {
  return vec ? Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength) : null;
}

function fromBlob(buf: Buffer | null): Float32Array | null {
  if (!buf) return null;
  const copy = new Uint8Array(buf);
  return new Float32Array(copy.buffer, 0, copy.byteLength / 4);
}

function rowToNode(r: NodeRow): StoredNode {
  return {
    id: r.id,
    key: r.key,
    label: r.label,
    type: r.type as NodeType,
    domain: r.domain as Domain,
    summary: r.summary,
    todo: r.todo,
    readLinks: JSON.parse(r.read_links) as ReadLink[],
    owner: r.owner,
    status: r.status as Status,
    sellable: r.sellable === 1,
    sourceKind: r.source_kind as SourceKind,
    sourceRef: r.source_ref,
    updatedAt: r.updated_at,
    ...rowVectors(r),
  };
}

function rowToUser(r: UserRow): StoredUser {
  return {
    id: r.id,
    name: r.name,
    role: r.role,
    teamDescription: r.team_description,
    seedVec: fromBlob(r.seed_vec),
    seedModel: r.seed_model,
    userVec: fromBlob(r.user_vec),
    ranked: r.ranked ? (JSON.parse(r.ranked) as string[]) : null,
    gravity: fromBlob(r.gravity),
    gravityVersion: r.gravity_version,
  };
}

function mergeLinks(a: ReadLink[], b: ReadLink[]): ReadLink[] {
  const seen = new Map<string, ReadLink>();
  for (const link of [...a, ...b]) {
    if (link.url) seen.set(link.url, link);
  }
  return [...seen.values()].slice(0, 8);
}

function cleanNode(n: ExtractedNode): ExtractedNode {
  return {
    ...n,
    label: clamp(n.label, LABEL_MAX),
    summary: clamp(n.summary, SUMMARY_MAX),
    todo: n.todo?.trim() ? clamp(n.todo, 200) : null,
    owner: n.owner?.trim() || null,
    readLinks: n.readLinks.filter((l) => /^https?:\/\//.test(l.url)).map((l) => ({ title: clamp(l.title || l.url, 80), url: l.url })),
  };
}

export class Store {
  constructor(readonly db: Database.Database) {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(SCHEMA);
    this.addColumns("nodes", { z: "BLOB", z_version: "TEXT", embed_ctx: "TEXT", cluster_id: "TEXT" });
    this.addColumns("users", { gravity: "BLOB", gravity_version: "TEXT" });
    this.addColumns("sources", { embed_ctx: "TEXT", cluster_id: "TEXT", ocr_text: "TEXT", image_status: "TEXT" });
  }

  private addColumns(table: string, cols: Record<string, string>): void {
    const have = new Set((this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
    for (const [name, type] of Object.entries(cols)) {
      if (!have.has(name)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  }

  static open(file: string): Store {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    return new Store(new Database(file));
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // Nodes

  listNodes(): StoredNode[] {
    return (this.db.prepare("SELECT * FROM nodes ORDER BY updated_at DESC").all() as NodeRow[]).map(rowToNode);
  }

  getNode(id: string): StoredNode | null {
    const row = this.db.prepare("SELECT * FROM nodes WHERE id = ?").get(id) as NodeRow | undefined;
    return row ? rowToNode(row) : null;
  }

  findNodeByKey(key: string): StoredNode | null {
    const row = this.db.prepare("SELECT * FROM nodes WHERE key = ?").get(key) as NodeRow | undefined;
    return row ? rowToNode(row) : null;
  }

  /** Resolve an edge endpoint written as an id or a label of any type. */
  resolveNodeRef(ref: string): StoredNode | null {
    const byId = this.getNode(ref) ?? this.getNode(slugify(ref));
    if (byId) return byId;
    const row = this.db
      .prepare("SELECT * FROM nodes WHERE substr(key, instr(key, ':') + 1) = ? ORDER BY updated_at DESC LIMIT 1")
      .get(normalizeLabel(ref)) as NodeRow | undefined;
    return row ? rowToNode(row) : null;
  }

  saveNode(n: StoredNode): void {
    this.db
      .prepare(
        `INSERT INTO nodes (id, key, label, type, domain, summary, todo, read_links, owner, status, sellable,
           source_kind, source_ref, updated_at, embedding, embed_model, embed_ctx, z, z_version, cluster_id)
         VALUES (@id, @key, @label, @type, @domain, @summary, @todo, @read_links, @owner, @status, @sellable,
           @source_kind, @source_ref, @updated_at, @embedding, @embed_model, @embed_ctx, @z, @z_version, @cluster_id)
         ON CONFLICT(id) DO UPDATE SET
           key = excluded.key, label = excluded.label, type = excluded.type, domain = excluded.domain,
           summary = excluded.summary, todo = excluded.todo, read_links = excluded.read_links,
           owner = excluded.owner, status = excluded.status, sellable = excluded.sellable,
           source_kind = excluded.source_kind, source_ref = excluded.source_ref, updated_at = excluded.updated_at,
           embedding = excluded.embedding, embed_model = excluded.embed_model, embed_ctx = excluded.embed_ctx,
           z = excluded.z, z_version = excluded.z_version, cluster_id = excluded.cluster_id`,
      )
      .run({
        id: n.id,
        key: n.key,
        label: n.label,
        type: n.type,
        domain: n.domain,
        summary: n.summary,
        todo: n.todo,
        read_links: JSON.stringify(n.readLinks),
        owner: n.owner,
        status: n.status,
        sellable: n.sellable ? 1 : 0,
        source_kind: n.sourceKind,
        source_ref: n.sourceRef,
        updated_at: n.updatedAt,
        embedding: toBlob(n.embedding),
        embed_model: n.embedModel,
        embed_ctx: n.embedCtx,
        z: toBlob(n.z),
        z_version: n.zVersion,
        cluster_id: n.clusterId,
      });
  }

  /** A new 768d vector invalidates the org-space vector and cluster derived from it. */
  setNodeEmbedding(id: string, vec: Float32Array, model: string, ctx: string | null = null): void {
    this.db
      .prepare("UPDATE nodes SET embedding = ?, embed_model = ?, embed_ctx = ?, z = NULL, z_version = NULL, cluster_id = NULL WHERE id = ?")
      .run(toBlob(vec), model, ctx, id);
  }

  setNodeZ(id: string, z: Float32Array, version: string): void {
    this.db.prepare("UPDATE nodes SET z = ?, z_version = ? WHERE id = ?").run(toBlob(z), version, id);
  }

  setClusterOf(kind: "node" | "source", id: string, clusterId: string | null): void {
    this.db.prepare(`UPDATE ${kind === "node" ? "nodes" : "sources"} SET cluster_id = ? WHERE id = ?`).run(clusterId, id);
  }

  // Compressors

  activeCompressor(): StoredCompressor | null {
    return this.compressorWhere("active = 1");
  }

  /** Most recent training attempt, adopted or not. */
  latestCompressor(): StoredCompressor | null {
    return this.compressorWhere("1 = 1");
  }

  private compressorWhere(where: string): StoredCompressor | null {
    const row = this.db.prepare(`SELECT * FROM compressors WHERE ${where} ORDER BY created_at DESC, rowid DESC LIMIT 1`).get() as
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

  /** Stores a compressor; when `activate` is set it becomes the only active one. */
  saveCompressor(c: Omit<StoredCompressor, "createdAt">, activate: boolean): void {
    this.transaction(() => {
      if (activate) this.db.exec("UPDATE compressors SET active = 0");
      this.db
        .prepare(
          `INSERT OR REPLACE INTO compressors (id, kind, weights, metrics, active, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(c.id, c.kind, toBlob(c.weights), JSON.stringify(c.metrics), activate ? 1 : 0, new Date().toISOString());
    });
  }

  private uniqueId(label: string, type: NodeType): string {
    const base = slugify(label);
    const taken = (id: string) => this.db.prepare("SELECT 1 FROM nodes WHERE id = ?").get(id) !== undefined;
    if (!taken(base)) return base;
    const typed = `${base}-${type}`;
    if (!taken(typed)) return typed;
    for (let i = 2; ; i++) {
      if (!taken(`${typed}-${i}`)) return `${typed}-${i}`;
    }
  }

  /**
   * Upsert by `type:normalizedLabel`. Newer non-null fields win; `unknown` status never
   * overwrites a known one. Edges are written only when both endpoints resolve.
   * Embeddings are cleared when label or summary change so the caller re-embeds them.
   */
  upsertGraph(update: GraphUpdate, prov: Provenance): { touched: string[]; edgesAdded: string[]; changes: NodeChange[] } {
    const now = prov.now ?? new Date().toISOString();
    return this.transaction(() => {
      const touched: string[] = [];
      const changes: NodeChange[] = [];
      const local = new Map<string, string>();

      for (const raw of update.nodes) {
        const incoming = cleanNode(raw);
        if (!incoming.label) continue;
        const key = nodeKey(incoming.type, incoming.label);
        const existing = this.findNodeByKey(key);

        let node: StoredNode;
        if (existing) {
          const textChanged = existing.label !== incoming.label || existing.summary !== (incoming.summary || existing.summary);
          node = {
            ...existing,
            label: incoming.label,
            domain: incoming.domain,
            summary: incoming.summary || existing.summary,
            todo: incoming.todo ?? existing.todo,
            readLinks: mergeLinks(existing.readLinks, incoming.readLinks),
            owner: incoming.owner ?? existing.owner,
            status: incoming.status !== "unknown" ? incoming.status : existing.status,
            sellable: incoming.sellable ?? existing.sellable,
            sourceKind: prov.sourceKind,
            sourceRef: prov.sourceRef,
            updatedAt: now,
            ...(textChanged ? NO_VECTORS : {}),
          };
        } else {
          node = {
            id: this.uniqueId(incoming.label, incoming.type),
            key,
            label: incoming.label,
            type: incoming.type,
            domain: incoming.domain,
            summary: incoming.summary,
            todo: incoming.todo,
            readLinks: incoming.readLinks,
            owner: incoming.owner,
            status: incoming.status,
            sellable: incoming.sellable ?? false,
            sourceKind: prov.sourceKind,
            sourceRef: prov.sourceRef,
            updatedAt: now,
            ...NO_VECTORS,
          };
        }
        this.saveNode(node);
        local.set(normalizeLabel(raw.label), node.id);
        local.set(normalizeLabel(node.label), node.id);
        if (!touched.includes(node.id)) {
          touched.push(node.id);
          changes.push({
            nodeId: node.id,
            change: existing ? "updated" : "created",
            statusFrom: existing ? existing.status : null,
            statusTo: node.status,
          });
        }
      }

      const resolve = (ref: string) => local.get(normalizeLabel(ref)) ?? this.resolveNodeRef(ref)?.id ?? null;
      const edgesAdded: string[] = [];
      for (const e of update.edges) {
        const source = resolve(e.source);
        const target = resolve(e.target);
        if (!source || !target || source === target) continue;
        const edge: Edge = { id: edgeId(source, e.relation, target), source, target, relation: e.relation, sourceRef: prov.sourceRef };
        if (this.addEdge(edge)) edgesAdded.push(edge.id);
      }
      return { touched, edgesAdded, changes };
    });
  }

  // Sources

  saveSource(s: NewSource, changes: NodeChange[]): void {
    this.transaction(() => {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO sources (id, kind, ref, title, text, ocr_text, image_status, author_id, image, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
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
      const stmt = this.db.prepare(
        `INSERT OR REPLACE INTO source_changes (source_id, node_id, change, status_from, status_to) VALUES (?, ?, ?, ?, ?)`,
      );
      for (const c of changes) stmt.run(s.id, c.nodeId, c.change, c.statusFrom, c.statusTo);
    });
  }

  getSource(id: string): StoredSource | null {
    const row = this.db.prepare(`SELECT ${SOURCE_COLS} FROM sources WHERE id = ?`).get(id) as SourceRow | undefined;
    return row ? rowToSource(row) : null;
  }

  /** The newest source of this kind and ref by this author, if any. */
  lastSourceBy(kind: SourceKind, ref: string, authorId: string): StoredSource | null {
    const row = this.db
      .prepare(`SELECT ${SOURCE_COLS} FROM sources WHERE ref = ? AND kind = ? AND author_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(ref, kind, authorId) as SourceRow | undefined;
    return row ? rowToSource(row) : null;
  }

  /** Newest first. `since` is an ISO timestamp. */
  listSources(since?: string, limit = -1): StoredSource[] {
    const rows = since
      ? this.db.prepare(`SELECT ${SOURCE_COLS} FROM sources WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?`).all(since, limit)
      : this.db.prepare(`SELECT ${SOURCE_COLS} FROM sources ORDER BY created_at DESC LIMIT ?`).all(limit);
    return (rows as SourceRow[]).map(rowToSource);
  }

  /** Who wrote what since `since`, without loading documents: one row per source. */
  sourceAuthorsSince(since: string): { authorId: string | null; createdAt: string }[] {
    return (
      this.db.prepare("SELECT author_id, created_at FROM sources WHERE created_at >= ? ORDER BY created_at DESC").all(since) as {
        author_id: string | null;
        created_at: string;
      }[]
    ).map((r) => ({ authorId: r.author_id, createdAt: r.created_at }));
  }

  counts(): { nodes: number; edges: number; sources: number } {
    return this.db
      .prepare("SELECT (SELECT COUNT(*) FROM nodes) AS nodes, (SELECT COUNT(*) FROM edges) AS edges, (SELECT COUNT(*) FROM sources) AS sources")
      .get() as { nodes: number; edges: number; sources: number };
  }

  /** Changes whenever an item, its embedding, its cluster, or the edges change. Cheap cache key for projections. */
  embeddingStamp(): string {
    const r = this.db
      .prepare(
        `SELECT (SELECT COUNT(*) || ':' || COUNT(embedding) || ':' || COUNT(z) || ':' || COUNT(cluster_id) || ':' || IFNULL(MAX(updated_at), '') FROM nodes) AS n,
                (SELECT COUNT(*) || ':' || COUNT(embedding) || ':' || COUNT(z) || ':' || COUNT(cluster_id) || ':' || IFNULL(MAX(created_at), '') FROM sources) AS s,
                (SELECT COUNT(*) FROM edges) AS e,
                (SELECT COUNT(*) || ':' || IFNULL(MAX(version), '') FROM clusters) AS c`,
      )
      .get() as { n: string; s: string; e: number; c: string };
    return `${r.n}|${r.s}|${r.e}|${r.c}`;
  }

  sourceImage(id: string): Buffer | null {
    const row = this.db.prepare("SELECT image FROM sources WHERE id = ?").get(id) as { image: Buffer | null } | undefined;
    return row?.image ?? null;
  }

  sourceChanges(sourceId: string): SourceChange[] {
    return (
      this.db
        .prepare(
          `SELECT c.node_id, n.label, c.change, c.status_from, c.status_to FROM source_changes c
           JOIN nodes n ON n.id = c.node_id WHERE c.source_id = ?`,
        )
        .all(sourceId) as { node_id: string; label: string; change: string; status_from: string | null; status_to: string }[]
    ).map((r) => ({
      nodeId: r.node_id,
      label: r.label,
      change: r.change as SourceChange["change"],
      statusFrom: r.status_from as Status | null,
      statusTo: r.status_to as Status,
    }));
  }

  /** Source ids behind a node, newest first. */
  sourceIdsForNode(nodeId: string, limit = 5): string[] {
    return (
      this.db
        .prepare(
          `SELECT s.id FROM source_changes c JOIN sources s ON s.id = c.source_id
           WHERE c.node_id = ? ORDER BY s.created_at DESC LIMIT ?`,
        )
        .all(nodeId, limit) as { id: string }[]
    ).map((r) => r.id);
  }

  /** A new 768d vector invalidates the org-space vector and cluster derived from it. */
  setSourceEmbedding(id: string, vec: Float32Array, model: string, ctx: string | null = null): void {
    this.db
      .prepare(
        "UPDATE sources SET embedding = ?, embed_model = ?, embed_ctx = ?, z = NULL, z_version = NULL, cluster_id = NULL WHERE id = ?",
      )
      .run(toBlob(vec), model, ctx, id);
  }

  /** Swaps in a processed screenshot and clears the vectors so it re-embeds. */
  replaceSourceImage(id: string, image: Buffer, status: ImageStatus): void {
    this.db
      .prepare(
        `UPDATE sources SET image = ?, image_status = ?, embedding = NULL, embed_model = NULL, embed_ctx = NULL,
           z = NULL, z_version = NULL, cluster_id = NULL WHERE id = ?`,
      )
      .run(image, status, id);
  }

  setSourceZ(id: string, z: Float32Array, version: string): void {
    this.db.prepare("UPDATE sources SET z = ?, z_version = ? WHERE id = ?").run(toBlob(z), version, id);
  }

  toPublicSource(s: StoredSource): Source {
    const author = s.authorId ? this.getUser(s.authorId) : null;
    const flat = s.text.replace(/\s+/g, " ").trim();
    return {
      id: s.id,
      kind: s.kind,
      ref: s.ref,
      title: s.title,
      excerpt: flat.length > EXCERPT_MAX ? `${flat.slice(0, EXCERPT_MAX - 3)}...` : flat,
      authorId: s.authorId,
      authorName: author?.name ?? null,
      createdAt: s.createdAt,
      hasImage: s.hasImage,
      changes: this.sourceChanges(s.id),
    };
  }

  // Facets, clusters, digests, summaries

  listFacets(): Facet[] {
    return (
      this.db.prepare("SELECT item_kind, item_id, area, use, text_hash FROM facets").all() as {
        item_kind: Facet["itemKind"];
        item_id: string;
        area: string;
        use: string;
        text_hash: string;
      }[]
    ).map((r) => ({ itemKind: r.item_kind, itemId: r.item_id, area: r.area, use: r.use, textHash: r.text_hash }));
  }

  saveFacets(facets: Facet[]): void {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO facets (item_kind, item_id, area, use, text_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const now = new Date().toISOString();
    this.transaction(() => facets.forEach((f) => stmt.run(f.itemKind, f.itemId, f.area, f.use, f.textHash, now)));
  }

  /** Clusters whose centroids live in the space of compressor `version`. */
  listClusters(version?: string): StoredCluster[] {
    const rows = (
      version
        ? this.db.prepare("SELECT * FROM clusters WHERE version = ? ORDER BY size DESC, label").all(version)
        : this.db.prepare("SELECT * FROM clusters ORDER BY size DESC, label").all()
    ) as { id: string; label: string; centroid: Buffer; size: number; version: string }[];
    return rows.map((r) => ({ id: r.id, label: r.label, centroid: fromBlob(r.centroid)!, size: r.size, version: r.version }));
  }

  /** Replaces every cluster and every item's assignment in one transaction. */
  replaceClusters(clusters: StoredCluster[], assign: { kind: "node" | "source"; id: string; clusterId: string | null }[]): void {
    this.transaction(() => {
      this.db.exec("DELETE FROM clusters; UPDATE nodes SET cluster_id = NULL; UPDATE sources SET cluster_id = NULL;");
      const stmt = this.db.prepare("INSERT INTO clusters (id, label, centroid, size, version) VALUES (?, ?, ?, ?, ?)");
      for (const c of clusters) stmt.run(c.id, c.label, toBlob(c.centroid), c.size, c.version);
      for (const a of assign) this.setClusterOf(a.kind, a.id, a.clusterId);
    });
  }

  listDigests(): StoredDigest[] {
    return (this.db.prepare("SELECT * FROM digests ORDER BY newest_at DESC").all() as DigestRow[]).map(rowToDigest);
  }

  getDigest(id: string): StoredDigest | null {
    const row = this.db.prepare("SELECT * FROM digests WHERE id = ?").get(id) as DigestRow | undefined;
    return row ? rowToDigest(row) : null;
  }

  saveDigest(d: StoredDigest): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO digests (id, title, text, members, members_key, cluster_id, fidelity, newest_at, created_at,
           embedding, embed_model) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
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

  deleteDigests(ids: string[]): void {
    const stmt = this.db.prepare("DELETE FROM digests WHERE id = ?");
    this.transaction(() => ids.forEach((id) => stmt.run(id)));
  }

  getSummary(sourceId: string): StoredSummary | null {
    const r = this.db.prepare("SELECT * FROM summaries WHERE source_id = ?").get(sourceId) as
      | { source_id: string; text: string; text_hash: string; fidelity: number }
      | undefined;
    return r ? { sourceId: r.source_id, text: r.text, textHash: r.text_hash, fidelity: r.fidelity } : null;
  }

  saveSummary(s: StoredSummary): void {
    this.db
      .prepare("INSERT OR REPLACE INTO summaries (source_id, text, text_hash, fidelity) VALUES (?, ?, ?, ?)")
      .run(s.sourceId, s.text, s.textHash, s.fidelity);
  }

  /** Full text of a document or digest by id. `ocrText` is what was read off a kept screenshot. */
  readDocument(id: string): { source: Source; text: string; ocrText: string; imageStatus: ImageStatus } | null {
    const s = this.getSource(id);
    if (s) return { source: this.toPublicSource(s), text: s.text, ocrText: s.ocrText, imageStatus: s.imageStatus };
    const d = this.getDigest(id);
    return d ? { source: this.toPublicDigest(d), text: d.text, ocrText: "", imageStatus: "none" } : null;
  }

  /** A digest in the same public shape as a source, with the documents it merges. */
  toPublicDigest(d: StoredDigest): Source {
    const members: SourceMember[] = d.members.flatMap((id) => {
      const s = this.getSource(id);
      if (!s) return [];
      const author = s.authorId ? this.getUser(s.authorId) : null;
      return [{ id: s.id, title: s.title, ref: s.ref, authorName: author?.name ?? null, createdAt: s.createdAt }];
    });
    const flat = d.text.replace(/\s+/g, " ").trim();
    return {
      id: d.id,
      kind: "digest",
      ref: members.map((m) => m.ref).join(" "),
      title: d.title,
      excerpt: flat.length > EXCERPT_MAX ? `${flat.slice(0, EXCERPT_MAX - 3)}...` : flat,
      authorId: null,
      authorName: [...new Set(members.flatMap((m) => m.authorName ?? []))].join(", ") || null,
      createdAt: d.newestAt,
      hasImage: false,
      changes: [...new Map(d.members.flatMap((id) => this.sourceChanges(id)).map((c) => [c.nodeId, c])).values()],
      members,
    };
  }

  // Edges

  listEdges(): Edge[] {
    return (this.db.prepare("SELECT * FROM edges").all() as EdgeRow[]).map((r) => ({
      id: r.id,
      source: r.source,
      target: r.target,
      relation: r.relation as Relation,
      sourceRef: r.source_ref,
    }));
  }

  /** Returns false when an endpoint is missing or the edge already exists. */
  addEdge(e: Edge): boolean {
    if (!this.getNode(e.source) || !this.getNode(e.target)) return false;
    const res = this.db
      .prepare("INSERT OR IGNORE INTO edges (id, source, target, relation, source_ref) VALUES (?, ?, ?, ?, ?)")
      .run(e.id, e.source, e.target, e.relation, e.sourceRef);
    return res.changes > 0;
  }

  // Org profile: one row per org file

  getOrg(): Org | null {
    const row = this.db.prepare("SELECT * FROM org LIMIT 1").get() as
      | { id: string; name: string; description: string; websites: string; context: string; created_at: string }
      | undefined;
    if (!row) return null;
    const { created_at, websites, ...rest } = row;
    return { ...rest, websites: JSON.parse(websites) as string[], createdAt: created_at };
  }

  saveOrg(o: Org): void {
    this.transaction(() => {
      this.db.prepare("DELETE FROM org WHERE id <> ?").run(o.id);
      this.db
        .prepare(
          `INSERT INTO org (id, name, description, websites, context, created_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
             websites = excluded.websites, context = excluded.context`,
        )
        .run(o.id, o.name, o.description, JSON.stringify(o.websites), o.context, o.createdAt);
    });
  }

  // Users

  listUsers(): StoredUser[] {
    return (this.db.prepare("SELECT * FROM users ORDER BY id").all() as UserRow[]).map(rowToUser);
  }

  getUser(id: string): StoredUser | null {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
    return row ? rowToUser(row) : null;
  }

  saveUser(u: User): void {
    this.db
      .prepare(
        `INSERT INTO users (id, name, role, team_description) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role,
           team_description = excluded.team_description, seed_vec = NULL, seed_model = NULL`,
      )
      .run(u.id, u.name, u.role, u.teamDescription);
  }

  setUserSeed(id: string, vec: Float32Array, model: string): void {
    this.db.prepare("UPDATE users SET seed_vec = ?, seed_model = ? WHERE id = ?").run(toBlob(vec), model, id);
  }

  setUserSteering(
    id: string,
    s: { userVec: Float32Array | null; gravity: Float32Array | null; gravityVersion: string | null; ranked: string[] },
  ): void {
    this.db
      .prepare("UPDATE users SET user_vec = ?, gravity = ?, gravity_version = ?, ranked = ? WHERE id = ?")
      .run(toBlob(s.userVec), toBlob(s.gravity), s.gravityVersion, JSON.stringify(s.ranked), id);
  }

  addTouches(userId: string, nodeIds: string[]): void {
    const stmt = this.db.prepare("INSERT OR IGNORE INTO touches (user_id, node_id) VALUES (?, ?)");
    this.transaction(() => nodeIds.forEach((id) => stmt.run(userId, id)));
  }

  touchedNodeIds(userId: string): string[] {
    return (this.db.prepare("SELECT node_id FROM touches WHERE user_id = ?").all(userId) as { node_id: string }[]).map(
      (r) => r.node_id,
    );
  }

  // Dashboards: one per person, stored as the spec JSON.

  getDashboard(userId: string): DashboardSpec | null {
    const row = this.db.prepare("SELECT spec FROM dashboards WHERE user_id = ?").get(userId) as { spec: string } | undefined;
    return row ? (JSON.parse(row.spec) as DashboardSpec) : null;
  }

  saveDashboard(userId: string, spec: DashboardSpec): void {
    this.db
      .prepare(
        `INSERT INTO dashboards (user_id, spec, origin, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET spec = excluded.spec, origin = excluded.origin, updated_at = excluded.updated_at`,
      )
      .run(userId, JSON.stringify(spec), spec.origin, spec.updatedAt);
  }

  deleteDashboard(userId: string): void {
    this.db.prepare("DELETE FROM dashboards WHERE user_id = ?").run(userId);
  }

  reset(): void {
    this.db.exec(
      `DELETE FROM dashboards; DELETE FROM summaries; DELETE FROM digests; DELETE FROM clusters; DELETE FROM facets; DELETE FROM source_changes;
       DELETE FROM sources; DELETE FROM touches; DELETE FROM edges; DELETE FROM nodes; DELETE FROM users; DELETE FROM compressors;`,
    );
  }
}
