import { normalize } from "@/llm/embed";

export const IN_DIM = 768;
/** The org space: small enough to scan and cluster cheaply, trained per org on how its documents are used. */
export const OUT_DIM = 64;

export type CompressorMetrics = {
  /** Mean overlap between 768d and org-space top-k neighbor sets on held-out items. */
  recallAtK: number;
  /** Same measure for plain Matryoshka truncation, the baseline a trained map must beat. */
  baselineRecallAtK: number;
  /** Held-out items whose nearest labeled neighbors share their area, in the org space. Null without labels. */
  areaPurity: number | null;
  baselineAreaPurity: number | null;
  labeledItems: number;
  k: number;
  trainItems: number;
  valItems: number;
  steps: number;
  finalLoss: number;
};

/** Per training vector: index of its area and of its use, -1 when the org model has not labeled it. */
export type Labels = { area: Int32Array; use: Int32Array };

export type Compressor = {
  id: string;
  kind: "mrl" | "trained";
  /** OUT_DIM x IN_DIM, row-major. */
  weights: Float32Array;
  metrics: CompressorMetrics | null;
};

/** EmbeddingGemma 2 is Matryoshka-trained, so its leading dims are already a usable small embedding. */
export function mrlCompressor(): Compressor {
  const weights = new Float32Array(OUT_DIM * IN_DIM);
  for (let o = 0; o < OUT_DIM; o++) weights[o * IN_DIM + o] = 1;
  return { id: `mrl-${OUT_DIM}`, kind: "mrl", weights, metrics: null };
}

/** Mean share of each labeled anchor's k nearest labeled neighbors (org space) that share its area. */
export function areaPurity(c: Compressor, xs: Float32Array[], labels: Labels, anchors: number[], k = 3): number | null {
  const labeled = xs.map((_, i) => i).filter((i) => labels.area[i] >= 0);
  const probes = anchors.filter((a) => labels.area[a] >= 0);
  if (!probes.length || labeled.length < 2) return null;
  const zs = xs.map((x) => compress(c, x));
  let total = 0;
  for (const a of probes) {
    const near = labeled
      .filter((j) => j !== a)
      .map((j) => [dotN(zs[a], zs[j]), j] as const)
      .sort((p, q) => q[0] - p[0])
      .slice(0, k);
    total += near.filter(([, j]) => labels.area[j] === labels.area[a]).length / near.length;
  }
  return total / probes.length;
}

function project(W: Float32Array, x: Float32Array): Float32Array {
  const z = new Float32Array(OUT_DIM);
  for (let o = 0; o < OUT_DIM; o++) {
    let s = 0;
    const row = o * IN_DIM;
    for (let i = 0; i < IN_DIM; i++) s += W[row + i] * x[i];
    z[o] = s;
  }
  return z;
}

/** 768d unit vector to 128d unit vector. */
export function compress(c: Compressor, x: Float32Array): Float32Array {
  return normalize(project(c.weights, x));
}

function dotN(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function topK(scores: number[], k: number, skip: number): Set<number> {
  return new Set(
    scores
      .map((s, j) => [s, j] as const)
      .filter(([, j]) => j !== skip)
      .sort((a, b) => b[0] - a[0])
      .slice(0, k)
      .map(([, j]) => j),
  );
}

/** Mean overlap of top-k neighbors in 768d vs the compressed space, for each anchor in `anchors`. */
export function neighborRecall(c: Compressor, xs: Float32Array[], anchors: number[], k: number): number {
  if (!anchors.length || xs.length < 2) return 1;
  const zs = xs.map((x) => compress(c, x));
  const kk = Math.min(k, xs.length - 1);
  let total = 0;
  for (const a of anchors) {
    const full = topK(xs.map((x) => dotN(xs[a], x)), kk, a);
    const small = topK(zs.map((z) => dotN(zs[a], z)), kk, a);
    let hit = 0;
    for (const j of small) if (full.has(j)) hit++;
    total += hit / kk;
  }
  return total / anchors.length;
}

export type TrainOptions = {
  steps?: number;
  batch?: number;
  lr?: number;
  /** Teacher temperature: lower means only the closest neighbors matter. */
  tauTeacher?: number;
  tauStudent?: number;
  /** Pulls W back toward MRL so a small corpus cannot overfit it. */
  anchorWeight?: number;
  /** Share of a labeled anchor's teacher that comes from org labels rather than 768d similarity. */
  labelWeight?: number;
  /** Within the label teacher, same use counts this much relative to same area. */
  useWeight?: number;
  k?: number;
  valFraction?: number;
  seed?: number;
};

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: T[], rand: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function softmaxRow(row: Float64Array, tau: number, skip: number): Float64Array {
  let max = -Infinity;
  for (let j = 0; j < row.length; j++) if (j !== skip) max = Math.max(max, row[j] / tau);
  const out = new Float64Array(row.length);
  let sum = 0;
  for (let j = 0; j < row.length; j++) {
    if (j === skip) continue;
    out[j] = Math.exp(row[j] / tau - max);
    sum += out[j];
  }
  for (let j = 0; j < row.length; j++) out[j] /= sum;
  return out;
}

/**
 * Label teacher for one anchor: weight on every labeled item sharing its area (1) or its use (useWeight),
 * normalized. Null when the anchor is unlabeled or nothing in the batch shares a label with it.
 */
function labelRow(labels: Labels, idx: number[], i: number, useWeight: number): Float64Array | null {
  const a = idx[i];
  if (labels.area[a] < 0) return null;
  const row = new Float64Array(idx.length);
  let sum = 0;
  for (let j = 0; j < idx.length; j++) {
    if (j === i) continue;
    const b = idx[j];
    const w = (labels.area[b] === labels.area[a] ? 1 : 0) + (labels.use[b] >= 0 && labels.use[b] === labels.use[a] ? useWeight : 0);
    row[j] = w;
    sum += w;
  }
  if (sum === 0) return null;
  for (let j = 0; j < row.length; j++) row[j] /= sum;
  return row;
}

/**
 * Similarity distillation with org supervision. For each anchor the teacher is the softmax over its 768d
 * cosine neighbors, mixed (labelWeight) with a label distribution over items the org model put in the same
 * area or use; the student is the softmax over org-space cosines. Minimizes KL(teacher || student) plus an
 * L2 pull toward the MRL map, with Adam on minibatches of anchors. Without labels it is plain distillation.
 */
export async function trainCompressor(xs: Float32Array[], opts: TrainOptions = {}, labels?: Labels): Promise<Compressor> {
  const {
    steps = 300,
    batch = 192,
    lr = 2e-3,
    tauTeacher = 0.05,
    tauStudent = 0.05,
    anchorWeight = 1e-3,
    labelWeight = 0.5,
    useWeight = 0.3,
    k = 10,
    valFraction = 0.2,
    seed = 7,
  } = opts;

  const rand = rng(seed);
  const order = shuffle(
    xs.map((_, i) => i),
    rand,
  );
  const nVal = Math.max(1, Math.floor(xs.length * valFraction));
  const val = order.slice(0, nVal);
  const train = order.slice(nVal);

  const base = mrlCompressor();
  const W = Float32Array.from(base.weights);
  const W0 = base.weights;
  const m = new Float32Array(W.length);
  const v = new Float32Array(W.length);
  const b1 = 0.9;
  const b2 = 0.999;
  let finalLoss = 0;

  for (let step = 1; step <= steps; step++) {
    // Yield between steps so training never stalls request handling.
    await new Promise<void>((resolve) => setImmediate(resolve));
    const idx = shuffle(train, rand).slice(0, Math.min(batch, train.length));
    const B = idx.length;
    const X = idx.map((i) => xs[i]);
    const Z = X.map((x) => project(W, x));
    const norms = Z.map((z) => Math.sqrt(dotN(z, z)) || 1);
    const U = Z.map((z, i) => z.map((zz) => zz / norms[i]) as Float32Array);

    // G[i][j]: d loss / d s_ij from anchor i's row.
    const G: Float64Array[] = [];
    let loss = 0;
    for (let i = 0; i < B; i++) {
      const teacher = new Float64Array(B);
      const student = new Float64Array(B);
      for (let j = 0; j < B; j++) {
        teacher[j] = dotN(X[i], X[j]);
        student[j] = dotN(U[i], U[j]);
      }
      const P = softmaxRow(teacher, tauTeacher, i);
      const L = labels ? labelRow(labels, idx, i, useWeight) : null;
      if (L) for (let j = 0; j < B; j++) P[j] = (1 - labelWeight) * P[j] + labelWeight * L[j];
      const Q = softmaxRow(student, tauStudent, i);
      const g = new Float64Array(B);
      for (let j = 0; j < B; j++) {
        if (j === i) continue;
        if (P[j] > 0) loss += P[j] * (Math.log(P[j]) - Math.log(Q[j] + 1e-12));
        g[j] = (Q[j] - P[j]) / tauStudent / B;
      }
      G.push(g);
    }
    finalLoss = loss / B;

    const grad = new Float32Array(W.length);
    for (let i = 0; i < B; i++) {
      // dL/du_i = sum_j (G_ij + G_ji) u_j
      const du = new Float64Array(OUT_DIM);
      for (let j = 0; j < B; j++) {
        const w = G[i][j] + G[j][i];
        if (w === 0) continue;
        for (let d = 0; d < OUT_DIM; d++) du[d] += w * U[j][d];
      }
      // dL/dz_i = (du - u (u . du)) / |z_i|
      let proj = 0;
      for (let d = 0; d < OUT_DIM; d++) proj += U[i][d] * du[d];
      const x = X[i];
      for (let d = 0; d < OUT_DIM; d++) {
        const dz = (du[d] - U[i][d] * proj) / norms[i];
        if (dz === 0) continue;
        const row = d * IN_DIM;
        for (let c = 0; c < IN_DIM; c++) grad[row + c] += dz * x[c];
      }
    }

    const bc1 = 1 - b1 ** step;
    const bc2 = 1 - b2 ** step;
    for (let p = 0; p < W.length; p++) {
      const gp = grad[p] + 2 * anchorWeight * (W[p] - W0[p]);
      m[p] = b1 * m[p] + (1 - b1) * gp;
      v[p] = b2 * v[p] + (1 - b2) * gp * gp;
      W[p] -= (lr * (m[p] / bc1)) / (Math.sqrt(v[p] / bc2) + 1e-8);
    }
  }

  const trained: Compressor = { id: `trained-${Date.now().toString(36)}`, kind: "trained", weights: W, metrics: null };
  trained.metrics = {
    recallAtK: neighborRecall(trained, xs, val, k),
    baselineRecallAtK: neighborRecall(base, xs, val, k),
    areaPurity: labels ? areaPurity(trained, xs, labels, val) : null,
    baselineAreaPurity: labels ? areaPurity(base, xs, labels, val) : null,
    labeledItems: labels ? labels.area.filter((a) => a >= 0).length : 0,
    k,
    trainItems: train.length,
    valItems: val.length,
    steps,
    finalLoss,
  };
  return trained;
}
