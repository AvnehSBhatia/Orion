import type { StoredCluster, Store } from "@/db/store";
import { normalize } from "@/llm/embed";
import { slugify } from "@/lib/text";
import type { Compressor } from "./compressor";

export const CLUSTER = {
  /** An area needs this many items to be its own cluster; smaller ones fold into the nearest. */
  minSize: 2,
  kmeansIters: 25,
} as const;

type Member = { kind: "node" | "source"; id: string; z: Float32Array; name: string };

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function centroid(zs: Float32Array[]): Float32Array {
  const out = new Float32Array(zs[0].length);
  for (const z of zs) for (let d = 0; d < out.length; d++) out[d] += z[d];
  return normalize(out);
}

export function nearestCluster<C extends { centroid: Float32Array }>(clusters: C[], z: Float32Array): C | null {
  let best: C | null = null;
  let bestScore = -Infinity;
  for (const c of clusters) {
    const s = dot(c.centroid, z);
    if (s > bestScore) [best, bestScore] = [c, s];
  }
  return best;
}

/** Deterministic k-means for orgs the model has not labeled yet: farthest-point init, cosine assignment. */
function kmeans(members: Member[], k: number): Member[][] {
  const seeds = [members[0].z];
  while (seeds.length < k) {
    const far = members.reduce((a, m) => (Math.max(...seeds.map((s) => dot(s, m.z))) < Math.max(...seeds.map((s) => dot(s, a.z))) ? m : a));
    seeds.push(far.z);
  }
  let groups: Member[][] = [];
  let cents = seeds;
  for (let it = 0; it < CLUSTER.kmeansIters; it++) {
    groups = cents.map(() => []);
    for (const m of members) {
      let bi = 0;
      for (let i = 1; i < cents.length; i++) if (dot(cents[i], m.z) > dot(cents[bi], m.z)) bi = i;
      groups[bi].push(m);
    }
    cents = groups.map((g, i) => (g.length ? centroid(g.map((m) => m.z)) : cents[i]));
  }
  return groups.filter((g) => g.length);
}

/**
 * One cluster per org area the model named, centroid = mean of its items in the org space of compressor `c`.
 * Items in small or unlabeled areas join the nearest cluster. Without labels, k-means with k ~ sqrt(n / 2),
 * each cluster named after its most central item. Replaces all clusters and assignments.
 */
export function buildClusters(store: Store, c: Compressor): StoredCluster[] {
  const members: Member[] = [
    ...store.listNodes().flatMap((n) => (n.z && n.zVersion === c.id ? [{ kind: "node" as const, id: n.id, z: n.z, name: n.label }] : [])),
    ...store.listSources().flatMap((s) => (s.z && s.zVersion === c.id ? [{ kind: "source" as const, id: s.id, z: s.z, name: s.title }] : [])),
  ];
  if (members.length < 2 * CLUSTER.minSize) {
    store.replaceClusters([], []);
    return [];
  }

  const facets = new Map(store.listFacets().map((f) => [`${f.itemKind}:${f.itemId}`, f.area]));
  const byArea = new Map<string, Member[]>();
  for (const m of members) {
    const area = facets.get(`${m.kind}:${m.id}`);
    if (area) byArea.set(area, [...(byArea.get(area) ?? []), m]);
  }
  let groups = [...byArea].filter(([, ms]) => ms.length >= CLUSTER.minSize).map(([label, ms]) => ({ label, ms }));
  if (groups.length < 2) {
    const k = Math.max(2, Math.round(Math.sqrt(members.length / 2)));
    groups = kmeans(members, k).map((ms) => {
      const cen = centroid(ms.map((m) => m.z));
      const core = ms.reduce((a, m) => (dot(m.z, cen) > dot(a.z, cen) ? m : a));
      return { label: core.name.toLowerCase().slice(0, 40), ms };
    });
  }

  const taken = new Set<string>();
  const clusters: StoredCluster[] = groups.map(({ label, ms }) => {
    let id = `cl-${slugify(label) || "area"}`;
    for (let i = 2; taken.has(id); i++) id = `cl-${slugify(label)}-${i}`;
    taken.add(id);
    return { id, label, centroid: centroid(ms.map((m) => m.z)), size: 0, version: c.id };
  });
  const home = new Map<string, string>();
  groups.forEach(({ ms }, i) => ms.forEach((m) => home.set(`${m.kind}:${m.id}`, clusters[i].id)));

  const assign = members.map((m) => {
    const clusterId = home.get(`${m.kind}:${m.id}`) ?? nearestCluster(clusters, m.z)!.id;
    clusters.find((cl) => cl.id === clusterId)!.size++;
    return { kind: m.kind, id: m.id, clusterId };
  });
  store.replaceClusters(clusters, assign);
  return clusters;
}
