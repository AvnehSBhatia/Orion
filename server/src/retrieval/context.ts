import type { Cluster, Edge, PublicNode, Relation, Source } from "@/contract/types";
import type { Store } from "@/db/store";
import { readGraph } from "@/graph/view";
import type { Embedder } from "@/llm/embed";
import { isEmptyFilter, matchingIds, type NodeFilter } from "./filters";
import { dot } from "@/lib/vector";
import { dropHidden, hiddenSourceIds, type Viewer } from "@/orgs/visibility";
import { activeCompressor } from "@/orgspace/embeddings";
import { lensFor, rankNodes, rankSources, type Lens, type Scored } from "./ranking";

const EXPAND: ReadonlySet<Relation> = new Set(["blocks", "feeds", "part_of"]);
/** The "latest" lane: changes this recent are pulled in even when they rank below the top hits. */
export const LATEST = { withinHours: 72, max: 3 } as const;
/**
 * From this specificity (see ADAPT in users.ts) a question is specific: it gets no "for you" lane, so it leads
 * with its own hits rather than the asker's work, and its hits and latest lane keep only matches (MATCH).
 */
export const SPECIFIC = 0.5;
/** Documents handed to the model: best matching ones plus the newest behind the leading nodes. */
export const SOURCES = { matches: 4, perNode: 1, max: 8 } as const;
/** Blockers, feeders, and parents are expanded from this many leading query hits (plus any for-you items). */
export const NEIGHBORS = { fromHits: 2 } as const;

export type ContextItem = PublicNode & { why: string };
export type ContextSource = Source & { why: string };
export type Context = { items: ContextItem[]; sources: ContextSource[] };

export function ago(at: string, now: number): string {
  const hours = Math.max(0, now - Date.parse(at)) / 3_600_000;
  if (hours < 1) return "updated just now";
  if (hours < 48) return `updated ${Math.round(hours)}h ago`;
  return `updated ${Math.round(hours / 24)}d ago`;
}

/** The org's areas in the active space, biggest first. */
export function publicClusters(store: Store): Cluster[] {
  return store.listClusters(activeCompressor(store).id).map(({ id, label, size }) => ({ id, label, size }));
}

const matchWhy = (s: Scored, q: boolean) => (q ? `match ${s.score.toFixed(2)}${s.cluster ? ` in ${s.cluster}` : ""}` : "ranked for you");

function nodesFrom(
  store: Store,
  lens: Lens,
  k: number,
  { filter = {}, withQuery = true, route = true }: { filter?: NodeFilter; withQuery?: boolean; route?: boolean } = {},
): ContextItem[] {
  const graph = readGraph(store);
  const allow = isEmptyFilter(filter) ? undefined : matchingIds(graph.nodes, filter, lens.now);
  const scored = rankNodes(store, withQuery ? lens : { ...lens, q: null }, k, allow, { route });
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const q = withQuery && !!lens.q;
  return scored.flatMap((s) => {
    const n = byId.get(s.id);
    return n ? [{ ...n, why: `${matchWhy(s, q)}, ${ago(n.updatedAt, lens.now)}` }] : [];
  });
}

/**
 * Keeps context light: when two or more of the chosen documents belong to one digest, they are replaced
 * by that digest at the position of the first. The originals stay readable by id.
 */
export function collapseDigests(store: Store, sources: ContextSource[], now: number, hidden: ReadonlySet<string> = new Set()): ContextSource[] {
  let out = [...sources];
  for (const d of store.listDigests()) {
    const hit = out.filter((s) => d.members.includes(s.id));
    if (hit.length < 2 || d.members.some((id) => hidden.has(id)) || !d.members.every((id) => store.getSource(id))) continue;
    const at = out.indexOf(hit[0]);
    out = out.filter((s) => !d.members.includes(s.id));
    out.splice(at, 0, { ...store.toPublicDigest(d), why: `digest of ${d.members.length} similar documents, ${ago(d.newestAt, now)}` });
  }
  return out;
}

/**
 * Structured filter over the reader's graph (ripple statuses applied), then ranked by the
 * person's gravity plus freshness: by `q` when given, otherwise by their center.
 */
export async function findNodes(
  store: Store,
  embedder: Embedder,
  {
    userId,
    q,
    k,
    filter = {},
    now = Date.now(),
  }: { userId: string; q?: string | null; k: number; filter?: NodeFilter; now?: number },
): Promise<ContextItem[]> {
  const lens = await lensFor(store, embedder, { userId, q, now });
  return lens ? nodesFrom(store, lens, k, { filter }) : [];
}

/** Best matching documents for the person and question, optionally limited to the last `sinceHours`. */
export async function findSources(
  store: Store,
  embedder: Embedder,
  { userId, q, k, sinceHours, viewer = null, now = Date.now() }: { userId: string; q?: string | null; k: number; sinceHours?: number | null; viewer?: Viewer; now?: number },
): Promise<ContextSource[]> {
  const lens = await lensFor(store, embedder, { userId, q, now });
  if (!lens) return [];
  const since = sinceHours ? now - sinceHours * 3_600_000 : null;
  const hidden = hiddenSourceIds(store, viewer);
  const found = rankSources(store, lens, k, (s) => !hidden.has(s.id) && (since === null || Date.parse(s.createdAt) >= since)).flatMap((r) => {
    const s = store.getSource(r.id);
    return s ? [{ ...store.toPublicSource(s), why: `${matchWhy(r, !!lens.q)}, ${ago(s.createdAt, now)}` }] : [];
  });
  return dropHidden(store, viewer, collapseDigests(store, found, now, hidden));
}

/**
 * What the model sees up front for one person and one question, in this order:
 * 1. for you: the top of the person's own ranking (gravity plus freshness), so open questions land on their work;
 *    left out for specific questions and for "what changed" ones (SPECIFIC),
 * 2. best: the top hits for the question (org-space scan, 768d rerank, person term scaled by how vague the
 *    question is, freshness),
 * 3. direct blockers, feeders, and parents of the leading items (for-you items and the top hits), so it can
 *    explain why something is at risk,
 * 4. latest: the most relevant changes from the last few days not already included; for a specific question
 *    only those that match it (SPECIFIC),
 * 5. ripple statuses and gap todos already applied by readGraph.
 * Plus the documents: the best matching sources for the question, then the newest source behind each leading node.
 * The question is embedded once and used for both.
 */
export async function buildContext(
  store: Store,
  embedder: Embedder,
  {
    userId,
    q,
    k = 16,
    hits = 6,
    forYou = 3,
    viewer = null,
    now = Date.now(),
  }: { userId: string; q: string; k?: number; hits?: number; forYou?: number; viewer?: Viewer; now?: number },
): Promise<Context> {
  const lens = await lensFor(store, embedder, { userId, q, now });
  if (!lens) return { items: [], sources: [] };

  const out = new Map<string, ContextItem>();
  const add = (items: ContextItem[], max: number, why: (n: ContextItem) => string) => {
    for (const n of items.filter((n) => !out.has(n.id)).slice(0, max)) {
      if (out.size >= k) return;
      out.set(n.id, { ...n, why: why(n) });
    }
  };

  // "What changed" is answered by the hits (person-weighted, freshness-heavy) and the latest lane, not by standing work.
  const mine = lens.q && (lens.q.recent || lens.q.specificity >= SPECIFIC) ? 0 : forYou;
  if (mine) add(nodesFrom(store, lens, mine, { withQuery: false }), mine, (n) => `for you, ${ago(n.updatedAt, now)}`);
  const forYouIds = [...out.keys()];
  // A specific question keeps only real matches (MATCH in users.ts), so the tail is not filled with whatever
  // ranks next; the best hit always stays.
  const specific = !!lens.q && lens.q.specificity >= SPECIFIC && !lens.q.recent;
  const nodeVecs = new Map(store.listNodes().map((n) => [n.id, n.embedding]));
  const matches = (id: string) => {
    const v = nodeVecs.get(id);
    return !specific || (!!v && v.length === lens.q!.bare.length && dot(lens.q!.bare, v) >= lens.q!.floor);
  };
  const hitList = nodesFrom(store, lens, hits + out.size).filter((n, i) => i === 0 || matches(n.id));
  add(hitList, hits, (n) => n.why);

  // Neighbors of what the answer leads with: the for-you items and the best few hits, not the tail.
  // They come before the latest lane, so a blocker of the top hit is never crowded out by unrelated news.
  const leadIds = new Set([...forYouIds, ...hitList.slice(0, NEIGHBORS.fromHits).map((n) => n.id)]);
  const top = [...out.values()].filter((n) => leadIds.has(n.id));

  const graph = readGraph(store);
  const byId = new Map<string, PublicNode>(graph.nodes.map((n) => [n.id, n]));
  const linked = (id: string): { other: string; e: Edge }[] =>
    graph.edges
      .filter((e) => EXPAND.has(e.relation) && (e.source === id || e.target === id))
      .map((e) => ({ other: e.source === id ? e.target : e.source, e }));

  for (const hit of top) {
    for (const { other, e } of linked(hit.id)) {
      if (out.size >= k) break;
      const n = byId.get(other);
      if (!n || out.has(n.id)) continue;
      out.set(n.id, { ...n, why: e.source === other ? `${e.relation} ${hit.label}` : `${hit.label} ${e.relation} this` });
    }
  }

  // News crosses areas, so the latest lane ranks every item rather than routing to one cluster. For a specific
  // question it only admits recent changes that match it (possibly from another area); for an open or
  // "what changed" question, any recent change ranked for the person.
  const since = now - LATEST.withinHours * 3_600_000;
  add(
    nodesFrom(store, lens, store.listNodes().length, { route: false }).filter((n) => Date.parse(n.updatedAt) >= since && matches(n.id)),
    LATEST.max,
    (n) => `latest, ${ago(n.updatedAt, now)}`,
  );
  const items = [...out.values()];

  const sources = new Map<string, ContextSource>();
  const hidden = hiddenSourceIds(store, viewer);
  for (const r of rankSources(store, lens, SOURCES.matches, (s) => !hidden.has(s.id))) {
    const s = store.getSource(r.id);
    if (s) sources.set(s.id, { ...store.toPublicSource(s), why: `matches the question${r.cluster ? ` in ${r.cluster}` : ""}, ${ago(s.createdAt, now)}` });
  }
  for (const n of items) {
    if (sources.size >= SOURCES.max) break;
    for (const id of store.sourceIdsForNode(n.id, SOURCES.perNode)) {
      const s = !sources.has(id) && !hidden.has(id) && store.getSource(id);
      if (s) sources.set(id, { ...store.toPublicSource(s), why: `behind ${n.label}, ${ago(s.createdAt, now)}` });
    }
  }
  return { items, sources: dropHidden(store, viewer, collapseDigests(store, [...sources.values()].slice(0, SOURCES.max), now, hidden)) };
}
