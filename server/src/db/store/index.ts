/**
 * The per-org SQLite store. `Store` is the whole API; each method is one line that hands its connection to the
 * table module holding the SQL:
 *
 *   schema.ts      tables and column migrations
 *   graph.ts       nodes, edges, and merging extracted updates (upsertGraph)
 *   sources.ts     captured pages and commits, screenshots, what each changed
 *   digests.ts     digests of similar sources, summaries, readDocument
 *   orgspace.ts    compressors, facets (area and use labels), clusters
 *   people.ts      the org profile, users, touches
 *   dashboards.ts  one saved dashboard per person
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { DashboardSpec, Edge, ImageStatus, Org, SourceKind, User } from "@/contract/types";
import * as dashboards from "./dashboards";
import * as digests from "./digests";
import * as graph from "./graph";
import * as orgspace from "./orgspace";
import * as people from "./people";
import { clearAll, migrate } from "./schema";
import * as sources from "./sources";
import type { Facet, GraphUpdate, NewSource, NodeChange, Provenance, StoredCluster, StoredCompressor, StoredDigest, StoredNode, StoredSource, StoredSummary } from "./types";

export * from "./keys";
export * from "./types";

/** Whole-org reads cached between writes. */
type MemoKey = "nodes" | "sourceMeta";

export class Store {
  /** Whole-org reads, reused until this connection writes anything (SQLite's total_changes() moves on every write). */
  private memo = new Map<MemoKey, { at: number; value: unknown }>();

  constructor(readonly db: Database.Database) {
    migrate(db);
  }

  static open(file: string): Store {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    return new Store(new Database(file));
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  private changes(): number {
    return (this.db.prepare("SELECT total_changes() AS n").get() as { n: number }).n;
  }

  private memoized<T>(key: MemoKey, load: () => T[]): T[] {
    const at = this.changes();
    const hit = this.memo.get(key);
    if (hit && hit.at === at) return [...(hit.value as T[])];
    const value = load();
    this.memo.set(key, { at, value });
    return [...value];
  }

  /**
   * Runs writes that cannot change the given memoized reads (for example per-user steering never touches nodes or
   * sources), and keeps those reads valid across them.
   */
  preserving<T>(keys: MemoKey[], fn: () => T): T {
    const before = this.changes();
    const fresh = keys.filter((k) => this.memo.get(k)?.at === before);
    const out = fn();
    const after = this.changes();
    for (const k of fresh) this.memo.get(k)!.at = after;
    return out;
  }

  /** Empties every table. */
  reset(): void {
    clearAll(this.db);
  }

  // Nodes and edges

  listNodes(): StoredNode[] {
    return this.memoized("nodes", () => graph.listNodes(this.db));
  }
  getNode = (id: string) => graph.getNode(this.db, id);
  findNodeByKey = (key: string) => graph.findNodeByKey(this.db, key);
  resolveNodeRef = (ref: string) => graph.resolveNodeRef(this.db, ref);
  saveNode = (n: StoredNode) => graph.saveNode(this.db, n);
  setNodeEmbedding = (id: string, vec: Float32Array, model: string, ctx: string | null = null) => graph.setNodeEmbedding(this.db, id, vec, model, ctx);
  setNodeZ = (id: string, z: Float32Array, version: string) => graph.setNodeZ(this.db, id, z, version);
  upsertGraph = (update: GraphUpdate, prov: Provenance) => graph.upsertGraph(this.db, update, prov);
  listEdges = () => graph.listEdges(this.db);
  addEdge = (e: Edge) => graph.addEdge(this.db, e);

  // Sources

  listSourceMeta() {
    return this.memoized("sourceMeta", () => sources.listSourceMeta(this.db));
  }
  saveSource = (s: NewSource, changes: NodeChange[]) => sources.saveSource(this.db, s, changes);
  getSource = (id: string) => sources.getSource(this.db, id);
  getSources = (ids: string[]) => sources.getSources(this.db, ids);
  lastSourceBy = (kind: SourceKind, ref: string, authorId: string) => sources.lastSourceBy(this.db, kind, ref, authorId);
  listSources = (since?: string, limit = -1) => sources.listSources(this.db, since, limit);
  plainVectors = () => sources.plainVectors(this.db);
  setPlainVectors = (items: { id: string; vec: Float32Array; model: string; hash: string }[]) => sources.setPlainVectors(this.db, items);
  sourceAuthorsSince = (since: string) => sources.sourceAuthorsSince(this.db, since);
  counts = () => sources.counts(this.db);
  embeddingStamp = () => sources.embeddingStamp(this.db);
  sourceImage = (id: string) => sources.sourceImage(this.db, id);
  sourceChanges = (sourceId: string) => sources.sourceChanges(this.db, sourceId);
  changesBySource = () => sources.changesBySource(this.db);
  sourceIdsForNode = (nodeId: string, limit = 5) => sources.sourceIdsForNode(this.db, nodeId, limit);
  setSourceEmbedding = (id: string, vec: Float32Array, model: string, ctx: string | null = null) => sources.setSourceEmbedding(this.db, id, vec, model, ctx);
  replaceSourceImage = (id: string, image: Buffer, status: ImageStatus) => sources.replaceSourceImage(this.db, id, image, status);
  setSourceZ = (id: string, z: Float32Array, version: string) => sources.setSourceZ(this.db, id, z, version);
  toPublicSource = (s: StoredSource) => sources.toPublicSource(this.db, s);

  // Digests and summaries

  listDigests = () => digests.listDigests(this.db);
  getDigest = (id: string) => digests.getDigest(this.db, id);
  saveDigest = (d: StoredDigest) => digests.saveDigest(this.db, d);
  deleteDigests = (ids: string[]) => digests.deleteDigests(this.db, ids);
  getSummary = (sourceId: string) => digests.getSummary(this.db, sourceId);
  saveSummary = (s: StoredSummary) => digests.saveSummary(this.db, s);
  toPublicDigest = (d: StoredDigest) => digests.toPublicDigest(this.db, d);
  readDocument = (id: string) => digests.readDocument(this.db, id);

  // Org space: compressors, facets, clusters

  activeCompressor = () => orgspace.activeCompressor(this.db);
  latestCompressor = () => orgspace.latestCompressor(this.db);
  saveCompressor = (c: Omit<StoredCompressor, "createdAt">, activate: boolean) => orgspace.saveCompressor(this.db, c, activate);
  listFacets = () => orgspace.listFacets(this.db);
  saveFacets = (facets: Facet[]) => orgspace.saveFacets(this.db, facets);
  listClusters = (version?: string) => orgspace.listClusters(this.db, version);
  setClusterOf = (kind: "node" | "source", id: string, clusterId: string | null) => orgspace.setClusterOf(this.db, kind, id, clusterId);
  replaceClusters = (clusters: StoredCluster[], assign: { kind: "node" | "source"; id: string; clusterId: string | null }[]) =>
    orgspace.replaceClusters(this.db, clusters, assign);

  // Org profile, people, touches

  getOrg = () => people.getOrg(this.db);
  saveOrg = (o: Org) => people.saveOrg(this.db, o);
  listUsers = () => people.listUsers(this.db);
  getUser = (id: string) => people.getUser(this.db, id);
  saveUser = (u: User) => people.saveUser(this.db, u);
  setUserSeed = (id: string, vec: Float32Array, model: string) => people.setUserSeed(this.db, id, vec, model);
  setUserSteering = (id: string, s: people.Steering) => people.setUserSteering(this.db, id, s);
  addTouches = (userId: string, nodeIds: string[]) => people.addTouches(this.db, userId, nodeIds);
  touchedNodeIds = (userId: string) => people.touchedNodeIds(this.db, userId);

  // Dashboards

  getDashboard = (userId: string) => dashboards.getDashboard(this.db, userId);
  saveDashboard = (userId: string, spec: DashboardSpec) => dashboards.saveDashboard(this.db, userId, spec);
  deleteDashboard = (userId: string) => dashboards.deleteDashboard(this.db, userId);
}
