// Personal ranking: scores nodes and sources for one person, with or without a question.
// Everything else in retrieval/ (context, feed, brief, MCP) builds on `lensFor` and `rank`.
import type { SourceMeta, StoredCluster, StoredUser, Store } from "@/db/store";
import { query, type Embedder } from "@/llm/embed";
import { dot } from "@/lib/vector";
import { compress, type Compressor } from "@/orgspace/compressor";
import { ROLE_CONTEXT, activeCompressor, roleContext } from "@/orgspace/embeddings";
import { gravityScore, type Gravity } from "@/orgspace/gravity";
import { recomputeUserVectors, userGravity } from "@/orgspace/personVectors";

/**
 * Query score = w768 cos768(q, item) + wZ gravityZ(q, item) + wP gravityZ(person, item), Z = the 64d org space.
 * The base weights (0.4 / 0.3 / 0.3) are rescaled per question by its specificity, see ADAPT.
 */
export const RERANK = { query768: 0.4, queryZ: 0.3, person: 0.3, shortlistFactor: 4, shortlistMin: 40 } as const;
/**
 * The person term adapts to the question. A vague question ("what should I do today") matches nothing in
 * particular, so the person's pull decides; a specific one ("google ads budget") should find that topic even
 * when the asker works elsewhere. Specificity in [0, 1] is how far the bare question's best item stands out
 * from its average item (768d cosine, max minus mean), mapped linearly from `lo` (vague) to `hi` (specific).
 * Measured with EmbeddingGemma on the demo org: explicit topics 0.13 to 0.24, vague and "what changed" questions
 * 0.04 to 0.06. As specificity rises the person weight falls from `personVague` to `personSpecific`, and the
 * query terms move from the asker's role-flavored embedding and their gravity metric to the bare question.
 */
export const ADAPT = { lo: 0.06, hi: 0.13, personVague: 0.6, personSpecific: 0.05 } as const;
/**
 * A question checks cluster centroids first and searches the nearest cluster, adding the next only to fill k.
 * Also probed: any cluster whose centroid fit is within `margin` (a fraction of the best fit, so it holds across
 * embedders with different cosine scales) of the best, since the route is then a near tie, and every cluster for
 * a question less specific than `minSpecificity` (it has no topic to route by). Measured with EmbeddingGemma on the
 * demo org: "who owns the audio streaming service" fit two clusters within 0.006 and routed to the wrong one.
 */
export const ROUTING = { enabled: true, probe: 1, margin: 0.035, minSpecificity: 0.5 } as const;
/**
 * Added to every score: weight * 2^(-age / halfLife). Breaks near ties toward newer work without burying relevance.
 * A question about what is new ("what changed today") uses the recent weight and half-life instead.
 */
export const FRESHNESS = { weight: 0.05, halfLifeHours: 48, recentWeight: 0.4, recentHalfLifeHours: 12 } as const;
const RECENT_INTENT = /\b(new|news|changed?|changes|latest|recent|recently|updates?|updated|since|yesterday|this week)\b/i;

/** True when the question asks what is new or changed rather than about a topic. */
export function asksRecent(text: string): boolean {
  return RECENT_INTENT.test(text);
}

export function freshness(
  updatedAt: string,
  now: number,
  { weight = FRESHNESS.weight, halfLifeHours = FRESHNESS.halfLifeHours }: { weight?: number; halfLifeHours?: number } = {},
): number {
  const ageHours = Math.max(0, now - Date.parse(updatedAt)) / 3_600_000;
  return Number.isFinite(ageHours) ? weight * 2 ** (-ageHours / halfLifeHours) : 0;
}

function spread(sims: number[]): { max: number; mean: number } {
  let max = -Infinity;
  let sum = 0;
  for (const x of sims) {
    max = Math.max(max, x);
    sum += x;
  }
  return { max, mean: sum / sims.length };
}

/** See ADAPT. `sims` are the bare question's cosines to every item. */
export function specificity(sims: number[]): number {
  if (!sims.length) return 0;
  const { max, mean } = spread(sims);
  return Math.min(1, Math.max(0, (max - mean - ADAPT.lo) / (ADAPT.hi - ADAPT.lo)));
}

/**
 * What counts as a match for a specific question: the bare-question cosine an item must reach, a share `floor`
 * of the way from the average item to the best one. Relative, so it holds across embedders.
 */
export const MATCH = { floor: 0.5 } as const;

export function matchFloor(sims: number[]): number {
  if (!sims.length) return -Infinity;
  const { max, mean } = spread(sims);
  return mean + MATCH.floor * (max - mean);
}

const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/**
 * True when the question names a work item outright: some label of two or more words appears in it word for word
 * ("who owns the audio streaming service"). Naming an item is as specific as a question gets, whatever the
 * embedding says about the rest of the words.
 */
export function namesItem(text: string, labels: string[]): boolean {
  const q = ` ${words(text).join(" ")} `;
  return labels.some((l) => {
    const w = words(l);
    return w.length >= 2 && q.includes(` ${w.join(" ")} `);
  });
}

/** Score weights for a question of specificity s: the person share interpolates, the query terms keep their ratio. */
export function weightsFor(s: number): { query768: number; queryZ: number; person: number } {
  const person = ADAPT.personVague + (ADAPT.personSpecific - ADAPT.personVague) * s;
  const q = RERANK.query768 + RERANK.queryZ;
  return { query768: ((1 - person) * RERANK.query768) / q, queryZ: ((1 - person) * RERANK.queryZ) / q, person };
}

export type Scored = {
  id: string;
  score: number;
  scoreZ: number;
  score768: number;
  person: number;
  fresh: number;
  /** Label of the cluster the question was routed to, when routing picked this item. */
  cluster: string | null;
};

/** Anything with a 768d vector, its org-space projection, and a cluster: nodes and sources. */
type Vectored = {
  id: string;
  embedding: Float32Array | null;
  embedModel: string | null;
  z: Float32Array | null;
  zVersion: string | null;
  clusterId: string | null;
};

/** One person's steering state plus, optionally, the embedded question. Build once, rank many lists. */
export type Lens = {
  user: StoredUser;
  grav: Gravity | null;
  compressor: Compressor;
  model: string;
  /**
   * x and z: the question with the asker's role. bare and topic: without it, in 768d and the org space (routing).
   * specificity: see ADAPT. floor: see MATCH. recent: the question asks what is new (see FRESHNESS).
   */
  q: {
    x: Float32Array;
    z: Float32Array;
    bare: Float32Array;
    topic: Float32Array;
    specificity: number;
    floor: number;
    recent: boolean;
  } | null;
  /** Clusters in the active compressor's space, for routing. */
  clusters: StoredCluster[];
  now: number;
};

export async function lensFor(
  store: Store,
  embedder: Embedder,
  { userId, q, now = Date.now() }: { userId: string; q?: string | null; now?: number },
): Promise<Lens | null> {
  let user = store.getUser(userId);
  if (!user) return null;
  const c = activeCompressor(store);
  let grav = userGravity(user, c);
  if (!grav || !user.userVec || user.seedModel !== embedder.model || user.ranked === null) {
    await recomputeUserVectors(store, embedder);
    user = store.getUser(userId)!;
    grav = userGravity(user, c);
  }
  const text = q?.trim();
  let qv: Lens["q"] = null;
  if (text && grav) {
    const role = ROLE_CONTEXT.queries ? roleContext(user) : null;
    const [x, b] = await embedder.embed(role ? [query(text, role), query(text)] : [query(text)]);
    const bare = b ?? x;
    const z = compress(c, x);
    const nodes = store.listNodes();
    const sims = [...nodes, ...store.listSourceMeta()]
      .filter((it) => it.embedding && it.embedModel === embedder.model)
      .map((it) => dot(bare, it.embedding!));
    const spec = namesItem(text, nodes.map((n) => n.label)) ? 1 : specificity(sims);
    qv = { x, z, bare, topic: b ? compress(c, b) : z, specificity: spec, floor: matchFloor(sims), recent: asksRecent(text) };
  }
  return { user, grav, compressor: c, model: embedder.model, q: qv, clusters: store.listClusters(c.id), now };
}

/**
 * Clusters ordered by centroid fit to the bare question. Measured on the demo org: 7 of 7 routes right this way,
 * 5 of 7 when the asker's role or gravity is mixed in, because a person's pull drags topics toward their own area.
 */
export function routeOrder(lens: Lens): { cluster: StoredCluster; score: number }[] {
  const { q } = lens;
  if (!q) return [];
  return lens.clusters.map((cluster) => ({ cluster, score: dot(q.topic, cluster.centroid) })).sort((a, b) => b.score - a.score);
}

/**
 * Sub-linear candidate set: the items in the nearest `probe` clusters and any cluster in a near tie with the
 * nearest, plus further clusters in order only while there are fewer than k candidates. `tier` is each
 * candidate's cluster rank (0 for near ties), so fill always ranks after the routed clusters. Items not yet in
 * any cluster are tier 0. A vague question is not routed at all (ROUTING.minSpecificity).
 */
function routed<T extends Vectored>(lens: Lens, items: T[], k: number): { items: T[]; tier: Map<string, number> } {
  const order = routeOrder(lens);
  const tier = new Map<string, number>();
  if (!ROUTING.enabled || !order.length || lens.q!.specificity < ROUTING.minSpecificity) return { items, tier };
  let count = 0;
  for (const [i, { cluster, score }] of order.entries()) {
    const close = order[0].score - score <= ROUTING.margin * Math.abs(order[0].score);
    if (i >= ROUTING.probe && count >= k && !close) break;
    // Near ties share the top tier, so the routed set is ranked by score rather than by cluster.
    tier.set(cluster.id, close ? 0 : i);
    count += items.filter((it) => it.clusterId === cluster.id).length;
  }
  return { items: items.filter((it) => it.clusterId === null || tier.has(it.clusterId)), tier };
}

/**
 * No query: every item scored against the person's center in the org space. With a query:
 * stage 0 routes to the nearest cluster centroid (unless `route` is off),
 * stage 1 scans its items in the org space, stage 2 reranks the shortlist with full 768d cosine, both plus the
 * person term. How much the person counts, and whether the query is matched as the asker would phrase it (role
 * context, pulled toward them, under their metric) or as asked, follows the question's specificity (ADAPT).
 * Both add a freshness bonus so the latest version of what the person needs comes first; a "what changed"
 * question gets a much larger one.
 */
export function rank<T extends Vectored>(
  lens: Lens,
  items: T[],
  at: (item: T) => string,
  k: number,
  { route = true }: { route?: boolean } = {},
): Scored[] {
  const { grav, q, now } = lens;
  if (!grav) return [];
  const usable = items.filter((it) => it.embedding && it.z && it.embedModel === lens.model && it.zVersion === lens.compressor.id);
  const { items: candidates, tier } = q && route ? routed(lens, usable, k) : { items: usable, tier: new Map<string, number>() };
  const tierOf = (it: T) => (it.clusterId ? tier.get(it.clusterId) ?? 0 : 0);
  const order = (a: { it: T; score: number }, b: { it: T; score: number }) => tierOf(a.it) - tierOf(b.it) || b.score - a.score;
  const labels = new Map(lens.clusters.map((c) => [c.id, c.label]));
  const clusterOf = (it: T) => (tier.size && it.clusterId ? labels.get(it.clusterId) ?? null : null);
  const fresh = q?.recent ? { weight: FRESHNESS.recentWeight, halfLifeHours: FRESHNESS.recentHalfLifeHours } : undefined;
  const scored = candidates.map((it) => ({ it, person: gravityScore(grav.center, it.z!, grav), fresh: freshness(at(it), now, fresh) }));

  if (!q) {
    return scored
      .map(({ it, person, fresh }) => ({ id: it.id, scoreZ: person, score768: 0, person, fresh, score: person + fresh, cluster: null }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  // A specific question is matched as asked: bare text, plain cosine. A vague one keeps the asker's role and metric.
  const s = q.specificity;
  const w = weightsFor(s);
  const queryZ = (z: Float32Array) => (1 - s) * gravityScore(q.z, z, grav) + s * dot(q.topic, z);
  const query768 = (x: Float32Array) => (1 - s) * dot(q.x, x) + s * dot(q.bare, x);
  const stage1 = (scoreZ: number, person: number) => (w.queryZ * scoreZ + w.person * person) / (w.queryZ + w.person);
  return scored
    .map((x) => {
      const scoreZ = queryZ(x.it.z!);
      return { ...x, scoreZ, score: stage1(scoreZ, x.person) + x.fresh };
    })
    .sort(order)
    .slice(0, Math.max(k * RERANK.shortlistFactor, RERANK.shortlistMin))
    .map(({ it, scoreZ, person, fresh }) => {
      const score768 = query768(it.embedding!);
      const relevance = w.query768 * score768 + w.queryZ * scoreZ + w.person * person;
      return { it, id: it.id, scoreZ, score768, person, fresh, score: relevance + fresh, cluster: clusterOf(it) };
    })
    .sort(order)
    .slice(0, k)
    .map(({ it: _it, ...s }) => s);
}

export function rankNodes(
  store: Store,
  lens: Lens,
  k: number,
  allow?: ReadonlySet<string>,
  opts?: { route?: boolean },
): Scored[] {
  if (!lens.grav) {
    return (lens.user.ranked ?? [])
      .filter((id) => !allow || allow.has(id))
      .slice(0, k)
      .map((id) => ({ id, score: 0, scoreZ: 0, score768: 0, person: 0, fresh: 0, cluster: null }));
  }
  const nodes = store.listNodes().filter((n) => !allow || allow.has(n.id));
  return rank(lens, nodes, (n) => n.updatedAt, k, opts);
}

export function rankSources(
  store: Store,
  lens: Lens,
  k: number,
  filter?: (s: SourceMeta) => boolean,
  opts?: { route?: boolean },
): Scored[] {
  const sources = store.listSourceMeta().filter((s) => !filter || filter(s));
  return rank(lens, sources, (s) => s.createdAt, k, opts);
}

export async function getContextScored(
  store: Store,
  embedder: Embedder,
  { userId, q, k, allow, now }: { userId: string; q?: string; k: number; allow?: ReadonlySet<string>; now?: number },
): Promise<Scored[]> {
  const lens = await lensFor(store, embedder, { userId, q, now });
  return lens ? rankNodes(store, lens, k, allow) : [];
}

export async function getContextIds(
  store: Store,
  embedder: Embedder,
  args: { userId: string; q?: string; k: number; allow?: ReadonlySet<string>; now?: number },
): Promise<string[]> {
  return (await getContextScored(store, embedder, args)).map((s) => s.id);
}
