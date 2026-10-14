import type { EmbeddingPoint, EmbeddingsResponse } from "@/contract/types";
import type { Store } from "@/db/store";
import { publicClusters } from "@/retrieval/context";
import { readGraph } from "./view";

export const MAX_POINTS = 1_500;
const ITERATIONS = 40;
const TOLERANCE = 1e-6;

/** Deterministic start vector, so the same data projects the same way on every poll. */
function seeded(d: number, k: number): Float64Array {
  const v = new Float64Array(d);
  for (let i = 0; i < d; i++) v[i] = Math.sin((i + 1) * 12.9898 + (k + 1) * 78.233) * 43758.5453 % 1;
  return v;
}

function normalize(v: Float64Array): number {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n);
  if (n > 0) for (let i = 0; i < v.length; i++) v[i] /= n;
  return n;
}

/**
 * Top `k` principal axes by power iteration with deflation, computing Cov * v as Xᵀ(X v) so the
 * d x d covariance is never built. Returns each row's coordinates on those axes (centered data).
 */
export function pca(rows: ArrayLike<number>[], k = 3, warm?: { axes?: Float64Array[] }): number[][] {
  const n = rows.length;
  if (!n) return [];
  const d = rows[0].length;
  const mean = new Float64Array(d);
  for (const r of rows) for (let j = 0; j < d; j++) mean[j] += r[j] / n;
  const X = rows.map((r) => {
    const c = new Float64Array(d);
    for (let j = 0; j < d; j++) c[j] = r[j] - mean[j];
    return c;
  });

  const axes: Float64Array[] = [];
  const xv = new Float64Array(n);
  for (let c = 0; c < Math.min(k, d); c++) {
    // Warm start from the last projection's axis: data changes a little between polls, so this converges in a few steps.
    const prev = warm?.axes?.[c];
    let v = prev && prev.length === d ? Float64Array.from(prev) : seeded(d, c);
    const deflate = (u: Float64Array) => {
      for (const a of axes) {
        let dot = 0;
        for (let j = 0; j < d; j++) dot += u[j] * a[j];
        for (let j = 0; j < d; j++) u[j] -= dot * a[j];
      }
    };
    deflate(v);
    normalize(v);
    for (let it = 0; it < ITERATIONS; it++) {
      for (let i = 0; i < n; i++) {
        let s = 0;
        const x = X[i];
        for (let j = 0; j < d; j++) s += x[j] * v[j];
        xv[i] = s;
      }
      const next = new Float64Array(d);
      for (let i = 0; i < n; i++) {
        const x = X[i];
        const s = xv[i];
        if (s !== 0) for (let j = 0; j < d; j++) next[j] += x[j] * s;
      }
      deflate(next);
      if (normalize(next) === 0) break; // no variance left in this direction
      let delta = 0;
      for (let j = 0; j < d; j++) delta += (next[j] - v[j]) ** 2;
      v = next;
      if (delta < TOLERANCE) break;
    }
    // Sign convention: the heaviest coordinate is positive, so axes do not flip between polls.
    let big = 0;
    for (let j = 1; j < d; j++) if (Math.abs(v[j]) > Math.abs(v[big])) big = j;
    if (v[big] < 0) for (let j = 0; j < d; j++) v[j] = -v[j];
    axes.push(v);
  }

  if (warm) warm.axes = axes;
  return X.map((x) =>
    Array.from({ length: k }, (_, c) => {
      const a = axes[c];
      if (!a) return 0;
      let s = 0;
      for (let j = 0; j < d; j++) s += x[j] * a[j];
      return s;
    }),
  );
}

/** Scales each column into [-1, 1] around zero, robust to outliers. */
export function scaleColumns(points: number[][]): number[][] {
  if (!points.length) return points;
  // Scale by the 90th percentile and squash with tanh, so one outlier cannot crush the rest into the center.
  const scale = points[0].map((_, c) => {
    const mags = points.map((p) => Math.abs(p[c])).sort((a, b) => a - b);
    return mags[Math.min(mags.length - 1, Math.floor(mags.length * 0.9))] || mags[mags.length - 1];
  });
  return points.map((p) => p.map((v, c) => (scale[c] > 0 ? Math.tanh((1.2 * v) / scale[c]) : 0)));
}

type Item = Omit<EmbeddingPoint, "x" | "y" | "z"> & { vec: Float32Array };

// On globalThis so dev reloads keep the projection and warm-start axes instead of recomputing cold.
const g = globalThis as unknown as {
  __orionProj?: Map<string, { stamp: string; value: EmbeddingsResponse; at: number }>;
  __orionAxes?: Map<string, { axes?: Float64Array[] }>;
};
const cache = (g.__orionProj ??= new Map());
const warmAxes = (g.__orionAxes ??= new Map());
/** While data streams in (the swarm), reproject at most this often; polls in between get the last projection. */
const FRESH_MS = 2_000;

/** Every node and document with a vector, newest first, projected to 3D. Cached per org until the data changes. */
export function projectEmbeddings(store: Store, orgId: string): EmbeddingsResponse {
  const now = Date.now();
  const hit = cache.get(orgId);
  if (hit && now - hit.at < FRESH_MS) return hit.value;
  const stamp = store.embeddingStamp();
  if (hit?.stamp === stamp) {
    hit.at = now;
    return hit.value;
  }

  const clusters = publicClusters(store);
  const clusterIds = new Set(clusters.map((c) => c.id));
  const cluster = (id: string | null) => (id && clusterIds.has(id) ? id : null);
  const names = new Map(store.listUsers().map((u) => [u.id, u.name]));
  const effective = new Map(readGraph(store).nodes.map((n) => [n.id, n.status]));

  // The 768d embedding when there is one, else the org-space vector.
  const items: Item[] = [
    ...store.listNodes().flatMap((n): Item[] => {
      const vec = n.embedding ?? n.z;
      return vec
        ? [{ id: n.id, kind: "node", label: n.label, domain: n.domain, status: effective.get(n.id) ?? n.status, clusterId: cluster(n.clusterId), author: n.owner, createdAt: n.updatedAt, vec }]
        : [];
    }),
    ...store.listSourceMeta().flatMap((s): Item[] => {
      const vec = s.embedding ?? s.z;
      return vec
        ? [{ id: s.id, kind: "source", label: s.title || s.ref, domain: null, status: null, clusterId: cluster(s.clusterId), author: s.authorId ? (names.get(s.authorId) ?? s.authorId) : null, createdAt: s.createdAt, vec }]
        : [];
    }),
  ]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_POINTS);

  // Vectors from different models can differ in size; only the most common size projects together.
  const bySize = new Map<number, number>();
  for (const it of items) bySize.set(it.vec.length, (bySize.get(it.vec.length) ?? 0) + 1);
  const dim = [...bySize].sort((a, b) => b[1] - a[1])[0]?.[0];
  // A vector with NaN or Infinity would poison every coordinate, so it sits out.
  const kept = items.filter((it) => it.vec.length === dim && it.vec.every(Number.isFinite));

  let warm = warmAxes.get(orgId);
  if (!warm) warmAxes.set(orgId, (warm = {}));
  const xyz = scaleColumns(pca(kept.map((it) => it.vec), 3, warm));
  const points: EmbeddingPoint[] = kept.map(({ vec: _vec, ...it }, i) => ({
    ...it,
    x: round(xyz[i][0]),
    y: round(xyz[i][1]),
    z: round(xyz[i][2]),
  }));
  const value: EmbeddingsResponse = { points, clusters };
  cache.set(orgId, { stamp, value, at: now });
  return value;
}

const round = (v: number) => (Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : 0);
