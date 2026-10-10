import { normalize } from "@/llm/embed";

export type Gravity = {
  /** Where this person sits in the 128d space. Unit length. */
  center: Float32Array;
  /** Per-component pull strength in [0, G_MAX]. Unique to each person. */
  g: Float32Array;
  /** Overall strength, grows with how much evidence we have about the person. */
  mass: number;
};

export const GRAVITY = {
  /** Mean component pull for a person with full evidence. */
  strength: 0.45,
  /** No component may move a vector more than this fraction toward the center. */
  maxPull: 0.9,
  /** Softening radius squared. Unit vectors are at most distance^2 4 apart; related items ~1. */
  softening2: 1,
  /** Evidence items (owned + touched) at which mass reaches 1. */
  fullEvidence: 10,
  /** Mass floor for a person we only know by role. */
  minMass: 0.5,
} as const;

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Per-component mean of a set of vectors. */
export function corpusMean(vectors: Float32Array[], dims: number): Float32Array {
  const m = new Float32Array(dims);
  for (const v of vectors) for (let d = 0; d < dims; d++) m[d] += v[d];
  if (vectors.length) for (let d = 0; d < dims; d++) m[d] /= vectors.length;
  return m;
}

/**
 * Component gravity from what makes this person distinct, not what every vector shares:
 * |mean_d(person) - mean_d(corpus)| / (std_d(person) + floor), over the center plus their owned
 * and touched items. With too little evidence it uses |center_d - corpus_d| alone.
 * Normalized to mean 1, scaled by strength and mass, then squashed smoothly under maxPull.
 */
export function fitGravity(center: Float32Array, evidence: Float32Array[], corpus: Float32Array): Gravity {
  const D = center.length;
  const mass = Math.min(1, GRAVITY.minMass + (1 - GRAVITY.minMass) * (evidence.length / GRAVITY.fullEvidence));
  const raw = new Float32Array(D);

  if (evidence.length >= 2) {
    const pts = [center, ...evidence];
    for (let d = 0; d < D; d++) {
      let mean = 0;
      for (const p of pts) mean += p[d];
      mean /= pts.length;
      let varSum = 0;
      for (const p of pts) varSum += (p[d] - mean) ** 2;
      const std = Math.sqrt(varSum / pts.length);
      raw[d] = Math.abs(mean - corpus[d]) / (std + 0.05);
    }
  } else {
    for (let d = 0; d < D; d++) raw[d] = Math.abs(center[d] - corpus[d]);
  }

  let avg = 0;
  for (let d = 0; d < D; d++) avg += raw[d];
  avg = avg / D || 1;

  const g = new Float32Array(D);
  for (let d = 0; d < D; d++) {
    g[d] = GRAVITY.maxPull * (1 - Math.exp(-GRAVITY.strength * mass * (raw[d] / avg)));
  }
  return { center, g, mass };
}

/**
 * Softened inverse-square falloff: phi = 1 / (1 + r^2 / eps^2). Each component moves toward the
 * center by g_d * phi of the gap, so a question already near the person's world bends hard toward
 * them and an off-topic one barely bends. Applied to queries only: pulling documents collapses the
 * ones near the person onto the center and erases what they are about.
 */
export function pull(z: Float32Array, grav: Gravity): Float32Array {
  const c = grav.center;
  let r2 = 0;
  for (let d = 0; d < z.length; d++) r2 += (z[d] - c[d]) ** 2;
  const phi = 1 / (1 + r2 / GRAVITY.softening2);
  const out = new Float32Array(z.length);
  for (let d = 0; d < z.length; d++) out[d] = z[d] + Math.min(GRAVITY.maxPull, grav.g[d] * phi) * (c[d] - z[d]);
  return normalize(out);
}

/** Cosine under the person's metric: component d counts (1 + g_d) times. */
export function weightedCosine(a: Float32Array, b: Float32Array, g: Float32Array): number {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let d = 0; d < a.length; d++) {
    const w = 1 + g[d];
    ab += w * a[d] * b[d];
    aa += w * a[d] * a[d];
    bb += w * b[d] * b[d];
  }
  return ab / (Math.sqrt(aa * bb) || 1);
}

/** The query falls toward the person, then is compared under their component weights. */
export function gravityScore(q: Float32Array, z: Float32Array, grav: Gravity): number {
  return weightedCosine(pull(q, grav), z, grav.g);
}

/** Packs a Gravity into one Float32Array blob: [mass, center..., g...]. */
export function packGravity(grav: Gravity): Float32Array {
  const out = new Float32Array(1 + grav.center.length * 2);
  out[0] = grav.mass;
  out.set(grav.center, 1);
  out.set(grav.g, 1 + grav.center.length);
  return out;
}

export function unpackGravity(buf: Float32Array): Gravity {
  const D = (buf.length - 1) / 2;
  return { mass: buf[0], center: buf.slice(1, 1 + D), g: buf.slice(1 + D) };
}
