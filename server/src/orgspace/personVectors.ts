// Where each person sits in the org space: their 768d vector, their gravity, and their stored no-query ranking.
import type { StoredUser, Store } from "@/db/store";
import type { Embedder } from "@/llm/embed";
import { normalize } from "@/lib/vector";
import { ownerMatches } from "@/orgs/people";
import { OUT_DIM, compress, type Compressor } from "./compressor";
import { activeCompressor, ensureEmbeddings, ensureOrgSpace } from "./embeddings";
import { corpusMean, fitGravity, gravityScore, packGravity, unpackGravity, type Gravity } from "./gravity";

export const USER_WEIGHTS = { seed: 0.5, owned: 0.3, touched: 0.2 } as const;

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

/** The person's stored gravity, when it was fit in the space of compressor `c`. */
export function userGravity(user: StoredUser, c: Compressor): Gravity | null {
  return user.gravity && user.gravityVersion === c.id ? unpackGravity(user.gravity) : null;
}

/**
 * Embeds and projects anything new, then per user:
 * 1. userVec (768d) = normalize(0.5 seed + 0.3 mean(owned) + 0.2 mean(touched)).
 * 2. center = compress(userVec) into the org space.
 * 3. component gravity from the agreement of owned and touched items in the org space.
 * 4. ranked = every node by gravity score against the center, stored for no-query lookups.
 */
export async function recomputeUserVectors(store: Store, embedder: Embedder): Promise<void> {
  await ensureEmbeddings(store, embedder);
  const c = activeCompressor(store);
  ensureOrgSpace(store, c);

  const nodes = store.listNodes().filter((n) => n.embedding && n.z && n.embedModel === embedder.model);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const corpus = corpusMean(
    nodes.map((n) => n.z!),
    OUT_DIM,
  );

  const authored = store.listSourceMeta().filter((s) => s.authorId && s.embedding && s.z && s.embedModel === embedder.model);

  const updates = store.listUsers().map((user) => {
    const owned = nodes.filter((n) => ownerMatches(n.owner, user));
    const touched = [...store.touchedNodeIds(user.id).flatMap((id) => byId.get(id) ?? []), ...authored.filter((s) => s.authorId === user.id)];
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

  store.preserving(["nodes", "sourceMeta"], () => store.transaction(() => updates.forEach(({ id, ...s }) => store.setUserSteering(id, s))));
}

/** After an ingest, how long to wait for more before refreshing. A burst of captures then embeds as one batch. */
const REFRESH_DEBOUNCE_MS = 1_000;

const refreshing = new WeakMap<Store, { timer: NodeJS.Timeout | null; running: boolean; again: boolean; after: (() => void)[] }>();

/**
 * recomputeUserVectors, debounced per org and one run at a time; ingests during a run trigger one more.
 * `after` runs once the refresh that covers this ingest is done. Never throws.
 */
export function refreshInBackground(store: Store, embedder: Embedder, after?: () => void): void {
  const s = refreshing.get(store) ?? { timer: null, running: false, again: false, after: [] };
  refreshing.set(store, s);
  if (after) s.after.push(after);
  if (s.running) {
    s.again = true;
    return;
  }
  if (s.timer) return;
  s.timer = setTimeout(async () => {
    s.timer = null;
    s.running = true;
    const done = s.after.splice(0);
    try {
      await recomputeUserVectors(store, embedder);
    } catch (err) {
      console.error("refresh after ingest failed", err);
    } finally {
      s.running = false;
      for (const fn of done) fn();
      if (s.again) {
        s.again = false;
        refreshInBackground(store, embedder);
      }
    }
  }, REFRESH_DEBOUNCE_MS);
  s.timer.unref?.();
}
