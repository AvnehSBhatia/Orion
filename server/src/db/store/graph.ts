// Nodes and edges: the work graph, and how extracted updates are merged into it.
import type { Domain, Edge, NodeType, ReadLink, Relation, SourceKind, Status } from "@/contract/types";
import { LABEL_MAX, SUMMARY_MAX, clamp, normalizeLabel, slugify } from "@/lib/text";
import { edgeId, nodeKey } from "./keys";
import { NO_VECTORS, rowVectors, toBlob, type Db, type VectorRow } from "./rows";
import type { ExtractedNode, GraphUpdate, NodeChange, Provenance, StoredNode } from "./types";

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

type EdgeRow = { id: string; source: string; target: string; relation: string; source_ref: string };

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

export function listNodes(db: Db): StoredNode[] {
  return (db.prepare("SELECT * FROM nodes ORDER BY updated_at DESC").all() as NodeRow[]).map(rowToNode);
}

export function getNode(db: Db, id: string): StoredNode | null {
  const row = db.prepare("SELECT * FROM nodes WHERE id = ?").get(id) as NodeRow | undefined;
  return row ? rowToNode(row) : null;
}

export function findNodeByKey(db: Db, key: string): StoredNode | null {
  const row = db.prepare("SELECT * FROM nodes WHERE key = ?").get(key) as NodeRow | undefined;
  return row ? rowToNode(row) : null;
}

/** Resolve an edge endpoint written as an id or a label of any type. */
export function resolveNodeRef(db: Db, ref: string): StoredNode | null {
  const byId = getNode(db, ref) ?? getNode(db, slugify(ref));
  if (byId) return byId;
  const row = db
    .prepare("SELECT * FROM nodes WHERE substr(key, instr(key, ':') + 1) = ? ORDER BY updated_at DESC LIMIT 1")
    .get(normalizeLabel(ref)) as NodeRow | undefined;
  return row ? rowToNode(row) : null;
}

export function saveNode(db: Db, n: StoredNode): void {
  db.prepare(
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
  ).run({
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
export function setNodeEmbedding(db: Db, id: string, vec: Float32Array, model: string, ctx: string | null): void {
  db.prepare("UPDATE nodes SET embedding = ?, embed_model = ?, embed_ctx = ?, z = NULL, z_version = NULL, cluster_id = NULL WHERE id = ?").run(
    toBlob(vec),
    model,
    ctx,
    id,
  );
}

export function setNodeZ(db: Db, id: string, z: Float32Array, version: string): void {
  db.prepare("UPDATE nodes SET z = ?, z_version = ? WHERE id = ?").run(toBlob(z), version, id);
}

export function listEdges(db: Db): Edge[] {
  return (db.prepare("SELECT * FROM edges").all() as EdgeRow[]).map((r) => ({
    id: r.id,
    source: r.source,
    target: r.target,
    relation: r.relation as Relation,
    sourceRef: r.source_ref,
  }));
}

/** Returns false when an endpoint is missing or the edge already exists. */
export function addEdge(db: Db, e: Edge): boolean {
  if (!getNode(db, e.source) || !getNode(db, e.target)) return false;
  const res = db
    .prepare("INSERT OR IGNORE INTO edges (id, source, target, relation, source_ref) VALUES (?, ?, ?, ?, ?)")
    .run(e.id, e.source, e.target, e.relation, e.sourceRef);
  return res.changes > 0;
}

function mergeLinks(a: ReadLink[], b: ReadLink[]): ReadLink[] {
  const seen = new Map<string, ReadLink>();
  for (const link of [...a, ...b]) {
    if (link.url) seen.set(link.url, link);
  }
  return [...seen.values()].slice(0, 8);
}

/** Model output is untrusted: clamp lengths, drop empty fields, keep only http(s) links. */
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

/** Ids are readable slugs of the label; a clash adds the type, then a number. */
function uniqueId(db: Db, label: string, type: NodeType): string {
  const base = slugify(label);
  const taken = (id: string) => db.prepare("SELECT 1 FROM nodes WHERE id = ?").get(id) !== undefined;
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
export function upsertGraph(db: Db, update: GraphUpdate, prov: Provenance): { touched: string[]; edgesAdded: string[]; changes: NodeChange[] } {
  const now = prov.now ?? new Date().toISOString();
  return db.transaction(() => {
    const touched: string[] = [];
    const changes: NodeChange[] = [];
    const local = new Map<string, string>();

    for (const raw of update.nodes) {
      const incoming = cleanNode(raw);
      if (!incoming.label) continue;
      const key = nodeKey(incoming.type, incoming.label);
      const existing = findNodeByKey(db, key);

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
          id: uniqueId(db, incoming.label, incoming.type),
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
      saveNode(db, node);
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

    const resolve = (ref: string) => local.get(normalizeLabel(ref)) ?? resolveNodeRef(db, ref)?.id ?? null;
    const edgesAdded: string[] = [];
    for (const e of update.edges) {
      const source = resolve(e.source);
      const target = resolve(e.target);
      if (!source || !target || source === target) continue;
      const edge: Edge = { id: edgeId(source, e.relation, target), source, target, relation: e.relation, sourceRef: prov.sourceRef };
      if (addEdge(db, edge)) edgesAdded.push(edge.id);
    }
    return { touched, edgesAdded, changes };
  })();
}
