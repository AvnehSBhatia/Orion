import { textHash, type StoredCluster, type StoredCompressor, type StoredNode, type StoredSource, type StoredUser, type Store } from "@/db/store";
import { doc, normalize, query, type Embedder } from "@/llm/embed";
import { nearestCluster } from "@/pseudo/clusters";
import { IN_DIM, OUT_DIM, compress, mrlCompressor, type Compressor } from "@/pseudo/compressor";
import { corpusMean, fitGravity, gravityScore, packGravity, unpackGravity, type Gravity } from "@/pseudo/gravity";

export const USER_WEIGHTS = { seed: 0.5, owned: 0.3, touched: 0.2 } as const;
/**
 * Query score = 0.4 cos768(q, item) + 0.3 gravityZ(q, item) + 0.3 gravityZ(person, item), Z = the 64d org space.
 * The person term keeps vague questions ("what should I do today") anchored to their work.
 */
export const RERANK = { query768: 0.4, queryZ: 0.3, person: 0.3, shortlistFactor: 4, shortlistMin: 40 } as const;
/**
 * Role context in embeddings: documents carry their author's role, questions the asker's.
 * Measured: it lifts same-role matches by about 0.06 to 0.08 cosine, so people see more from their own corner.
 */
export const ROLE_CONTEXT = { documents: true, queries: true, maxChars: 240 } as const;
/** A question checks cluster centroids first and searches only the nearest cluster, adding the next only to fill k. */
export const ROUTING = { enabled: true, probe: 1 } as const;
/** Added to every score: weight * 2^(-age / halfLife). Breaks near ties toward newer work without burying relevance. */
export const FRESHNESS = { weight: 0.05, halfLifeHours: 48 } as const;

export function freshness(updatedAt: string, now: number): number {
  const ageHours = Math.max(0, now - Date.parse(updatedAt)) / 3_600_000;
  return Number.isFinite(ageHours) ? FRESHNESS.weight * 2 ** (-ageHours / FRESHNESS.halfLifeHours) : 0;
}

export function dot(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export function mean(vecs: Float32Array[]): Float32Array | null {
  if (!vecs.length) return null;
  const out = new Float32Array(vecs[0].length);
  for (const v of vecs) for (let i = 0; i < out.length; i++) out[i] += v[i];
  for (let i = 0; i < out.length; i++) out[i] /= vecs.length;
  return out;
}

/** Weighted sum of the present parts, weights renormalized over what is present, then unit length. */
export function blend(parts: { weight: number; vec: Float32Array | null }[]): Float32Array | null {
  const present = parts.filter((p): p is { weight: number; vec: Float32Array } => p.vec !== null);
  if (!present.length) return null;
  const total = present.reduce((s, p) => s + p.weight, 0);
  const out = new Float32Array(present[0].vec.length);
  for (const { weight, vec } of present) {
    const w = weight / total;
    for (let i = 0; i < out.length; i++) out[i] += w * vec[i];
  }
  return normalize(out);
}

export function ownerMatches(owner: string | null, user: Pick<StoredUser, "id" | "name">): boolean {
  if (!owner) return false;
  const o = owner.trim().toLowerCase();
  const name = user.name.toLowerCase();
  return o === name || o === user.id.toLowerCase() || o === name.split(/\s+/)[0];
}

/** A person's profile reads like a standing search, so it embeds as a query. */
export function seedInput(user: Pick<StoredUser, "role" | "teamDescription">) {
  return query(`${user.role}. ${user.teamDescription}`);
}

export function roleContext(user: Pick<StoredUser, "role"> | null | undefined): string | null {
  const role = user?.role.replace(/\s+/g, " ").trim();
  return role ? role.slice(0, ROLE_CONTEXT.maxChars) : null;
}

/** The role a node's text is embedded with: its owner's, when the owner is someone in the org. */
export function nodeContext(node: Pick<StoredNode, "owner">, users: StoredUser[]): string | null {
  return ROLE_CONTEXT.documents ? roleContext(users.find((u) => ownerMatches(node.owner, u))) : null;
}

export function sourceContext(s: Pick<StoredSource, "authorId">, users: StoredUser[]): string | null {
  return ROLE_CONTEXT.documents ? roleContext(users.find((u) => u.id === s.authorId)) : null;
}

const ctxKey = (ctx: string | null) => (ctx ? textHash(ctx) : null);

export function nodeInput(node: Pick<StoredNode, "label" | "summary">, ctx: string | null = null) {
  return doc(node.label, node.summary, null, ctx);
}

export function activeCompressor(store: Store): Compressor {
  const c: StoredCompressor | null = store.activeCompressor();
  return c && c.weights.length === OUT_DIM * IN_DIM ? { id: c.id, kind: c.kind, weights: c.weights, metrics: null } : mrlCompressor();
}

/**
 * A source embeds as one document: its title, visible text or diff (plus any screenshot text not already
 * in it), and the screenshot itself when one was kept.
 */
export function sourceInput(store: Store, s: StoredSource, ctx: string | null = null) {
  const image = s.hasImage ? store.sourceImage(s.id)?.toString("base64") ?? null : null;
  const text = s.ocrText && !s.text.trim() ? s.ocrText : s.text;
  return doc(s.title || s.ref, text.slice(0, SOURCE_EMBED_CHARS), image, ctx);
}
const SOURCE_EMBED_CHARS = 4_000;

/**
 * Embeds nodes, sources, and user seeds that are missing a 768d vector, were embedded with another model,
 * or with a role context that has since changed (an author edited their role, a node changed owner).
 */
export async function ensureEmbeddings(store: Store, embedder: Embedder): Promise<number> {
  const users = store.listUsers();
  const stale = (x: { embedding: Float32Array | null; embedModel: string | null; embedCtx: string | null }, ctx: string | null) =>
    !x.embedding || x.embedModel !== embedder.model || (x.embedCtx ?? null) !== ctxKey(ctx);
  const nodes = store
    .listNodes()
    .map((n) => ({ n, ctx: nodeContext(n, users) }))
    .filter(({ n, ctx }) => stale(n, ctx));
  const sources = store
    .listSources()
    .map((s) => ({ s, ctx: sourceContext(s, users) }))
    .filter(({ s, ctx }) => stale(s, ctx));
  const seeds = users.filter((u) => !u.seedVec || u.seedModel !== embedder.model);
  if (!nodes.length && !sources.length && !seeds.length) return 0;

  const vecs = await embedder.embed([
    ...nodes.map(({ n, ctx }) => nodeInput(n, ctx)),
    ...sources.map(({ s, ctx }) => sourceInput(store, s, ctx)),
    ...seeds.map(seedInput),
  ]);
  store.transaction(() => {
    let i = 0;
    for (const { n, ctx } of nodes) store.setNodeEmbedding(n.id, vecs[i++], embedder.model, ctxKey(ctx));
    for (const { s, ctx } of sources) store.setSourceEmbedding(s.id, vecs[i++], embedder.model, ctxKey(ctx));
    for (const u of seeds) store.setUserSeed(u.id, vecs[i++], embedder.model);
  });
  return nodes.length + sources.length + seeds.length;
}

/**
 * Projects every node and source whose org-space vector is missing or came from another compressor,
 * and drops newly projected items into the nearest existing cluster so routing sees them at once.
 */
export function ensurePseudo(store: Store, c: Compressor): void {
  const nodes = store.listNodes().filter((n) => n.embedding && n.zVersion !== c.id);
  const sources = store.listSources().filter((s) => s.embedding && s.zVersion !== c.id);
  if (!nodes.length && !sources.length) return;
  const clusters = store.listClusters(c.id);
  store.transaction(() => {
    for (const [kind, items] of [["node", nodes], ["source", sources]] as const) {
      for (const it of items) {
        const z = compress(c, it.embedding!);
        if (kind === "node") store.setNodeZ(it.id, z, c.id);
        else store.setSourceZ(it.id, z, c.id);
        store.setClusterOf(kind, it.id, nearestCluster(clusters, z)?.id ?? null);
      }
    }
  });
}

export function userGravity(user: StoredUser, c: Compressor): Gravity | null {
  return user.gravity && user.gravityVersion === c.id ? unpackGravity(user.gravity) : null;
}

/**
 * Per user:
 * 1. userVec (768d) = normalize(0.5 seed + 0.3 mean(owned) + 0.2 mean(touched)).
 * 2. center (128d) = compress(userVec).
 * 3. component gravity from the agreement of owned and touched items in 128d.
 * 4. ranked = every node by gravity score against the center, stored for no-query lookups.
 */
export async function recomputeUserVectors(store: Store, embedder: Embedder): Promise<void> {
  await ensureEmbeddings(store, embedder);
  const c = activeCompressor(store);
  ensurePseudo(store, c);

  const nodes = store.listNodes().filter((n) => n.embedding && n.z && n.embedModel === embedder.model);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const corpus = corpusMean(
    nodes.map((n) => n.z!),
    OUT_DIM,
  );

  const authored = store
    .listSources()
    .filter((s) => s.authorId && s.embedding && s.z && s.embedModel === embedder.model);

  const updates = store.listUsers().map((user) => {
    const owned = nodes.filter((n) => ownerMatches(n.owner, user));
    const touched = [
      ...store.touchedNodeIds(user.id).flatMap((id) => byId.get(id) ?? []),
      ...authored.filter((s) => s.authorId === user.id),
    ];
    const userVec = blend([
      { weight: USER_WEIGHTS.seed, vec: user.seedVec },
      { weight: USER_WEIGHTS.owned, vec: mean(owned.map((n) => n.embedding!)) },
      { weight: USER_WEIGHTS.touched, vec: mean(touched.map((n) => n.embedding!)) },
    ]);
    if (!userVec) return { id: user.id, userVec: null, gravity: null, gravityVersion: null, ranked: [] };

    const evidence = [...new Map([...owned, ...touched].map((n) => [n.id, n.z!])).values()];
    const grav = fitGravity(compress(c, userVec), evidence, corpus);
    const ranked = nodes
      .map((n) => ({ id: n.id, score: gravityScore(grav.center, n.z!, grav) }))
      .sort((a, b) => b.score - a.score)
      .map((r) => r.id);
    return { id: user.id, userVec, gravity: packGravity(grav), gravityVersion: c.id, ranked };
  });

  store.transaction(() => updates.forEach(({ id, ...s }) => store.setUserSteering(id, s)));
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
  /** x and z: the question with the asker's role, for ranking. topic: the bare question in the org space, for routing. */
  q: { x: Float32Array; z: Float32Array; topic: Float32Array } | null;
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
    const [x, bare] = await embedder.embed(role ? [query(text, role), query(text)] : [query(text)]);
    const z = compress(c, x);
    qv = { x, z, topic: bare ? compress(c, bare) : z };
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
 * Sub-linear candidate set: the items in the nearest `probe` clusters, plus further clusters in order only
 * while there are fewer than k candidates. `tier` is each candidate's cluster rank, so fill always ranks after
 * the routed cluster. Items not yet in any cluster are tier 0.
 */
function routed<T extends Vectored>(lens: Lens, items: T[], k: number): { items: T[]; tier: Map<string, number> } {
  const order = routeOrder(lens);
  const tier = new Map<string, number>();
  if (!ROUTING.enabled || !order.length) return { items, tier };
  let count = 0;
  for (const [i, { cluster }] of order.entries()) {
    if (i >= ROUTING.probe && count >= k) break;
    tier.set(cluster.id, i);
    count += items.filter((it) => it.clusterId === cluster.id).length;
  }
  return { items: items.filter((it) => it.clusterId === null || tier.has(it.clusterId)), tier };
}

/**
 * No query: every item scored against the person's center in the org space. With a query:
 * stage 0 routes to the nearest cluster centroid (unless `route` is off),
 * stage 1 scans its items in the org space with the query fallen toward the person, under their component weights,
 * stage 2 reranks the shortlist with full 768d cosine plus the person term.
 * Both add a freshness bonus so the latest version of what the person needs comes first.
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
  const scored = candidates.map((it) => ({ it, person: gravityScore(grav.center, it.z!, grav), fresh: freshness(at(it), now) }));

  if (!q) {
    return scored
      .map(({ it, person, fresh }) => ({ id: it.id, scoreZ: person, score768: 0, person, fresh, score: person + fresh, cluster: null }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  const stage1 = (scoreZ: number, person: number) =>
    (RERANK.queryZ * scoreZ + RERANK.person * person) / (RERANK.queryZ + RERANK.person);
  return scored
    .map((x) => {
      const scoreZ = gravityScore(q.z, x.it.z!, grav);
      return { ...x, scoreZ, score: stage1(scoreZ, x.person) + x.fresh };
    })
    .sort(order)
    .slice(0, Math.max(k * RERANK.shortlistFactor, RERANK.shortlistMin))
    .map(({ it, scoreZ, person, fresh }) => {
      const score768 = dot(q.x, it.embedding!);
      const relevance = RERANK.query768 * score768 + RERANK.queryZ * scoreZ + RERANK.person * person;
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
  filter?: (s: StoredSource) => boolean,
  opts?: { route?: boolean },
): Scored[] {
  const sources = store.listSources().filter((s) => !filter || filter(s));
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
