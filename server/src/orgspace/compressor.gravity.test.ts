import { describe, expect, it } from "vitest";
import { normalize } from "@/lib/vector";
import { IN_DIM, OUT_DIM, compress, mrlCompressor, neighborRecall, trainCompressor } from "./compressor";
import { GRAVITY, corpusMean, fitGravity, gravityScore, packGravity, pull, unpackGravity } from "./gravity";

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
}

/** Clustered 768d unit vectors whose cluster structure lives partly outside the first 128 dims. */
function corpus(n: number, clusters = 6, seed = 1): Float32Array[] {
  const r = rng(seed);
  const centers = Array.from({ length: clusters }, () => normalize(Float32Array.from({ length: IN_DIM }, r)));
  return Array.from({ length: n }, (_, i) => {
    const c = centers[i % clusters];
    return normalize(Float32Array.from({ length: IN_DIM }, (_, d) => c[d] + 0.35 * r()));
  });
}

const unit = (D: number, hot: number[]) => normalize(Float32Array.from({ length: D }, (_, d) => (hot.includes(d) ? 1 : 0.01)));
const dot = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * b[i], 0);

describe("compressor", () => {
  it("starts as Matryoshka truncation: first 128 dims, renormalized", () => {
    const [x] = corpus(1);
    const z = compress(mrlCompressor(), x);
    expect(z).toHaveLength(OUT_DIM);
    expect(dot(z, z)).toBeCloseTo(1);
    expect(z[5] / z[6]).toBeCloseTo(x[5] / x[6]);
  });

  it("training beats truncation on held-out neighbor recall", async () => {
    const xs = corpus(120);
    const trained = await trainCompressor(xs, { steps: 120, batch: 96, seed: 3 });
    const m = trained.metrics!;
    expect(m.trainItems + m.valItems).toBe(120);
    expect(m.recallAtK).toBeGreaterThan(m.baselineRecallAtK);
    const val = Array.from({ length: 24 }, (_, i) => i);
    expect(neighborRecall(trained, xs, val, 10)).toBeGreaterThan(0);
  }, 30_000);

  it("org labels pull same-area items together where truncation cannot see the area", async () => {
    const r = rng(5);
    const topics = Array.from({ length: 5 }, () => normalize(Float32Array.from({ length: IN_DIM }, r)));
    // Area signal lives only beyond the leading dims, so plain truncation drops it.
    const areas = Array.from({ length: 3 }, () => normalize(Float32Array.from({ length: IN_DIM }, (_, d) => (d >= 2 * OUT_DIM ? r() : 0))));
    const xs = Array.from({ length: 120 }, (_, i) =>
      normalize(Float32Array.from({ length: IN_DIM }, (_, d) => topics[i % 5][d] + 0.3 * r() + 0.8 * areas[i % 3][d])),
    );
    const labels = { area: Int32Array.from(xs, (_, i) => i % 3), use: Int32Array.from(xs, () => -1) };
    const m = (await trainCompressor(xs, { steps: 150, batch: 96, seed: 3 }, labels)).metrics!;
    expect(m.labeledItems).toBe(120);
    expect(m.areaPurity!).toBeGreaterThan(m.baselineAreaPurity! + 0.1);
  }, 30_000);
});

describe("gravity", () => {
  const D = 8;
  const zero = new Float32Array(D);

  it("pulls hardest on components where the person's items agree and differ from the corpus", () => {
    const center = unit(D, [0]);
    const evidence = [unit(D, [0, 1]), unit(D, [0, 2]), unit(D, [0, 3])];
    const g = fitGravity(center, evidence, zero);
    expect(g.g[0]).toBe(Math.max(...g.g));
    expect(Math.max(...g.g)).toBeLessThan(GRAVITY.maxPull);
    expect(g.mass).toBeCloseTo(GRAVITY.minMass + (1 - GRAVITY.minMass) * 0.3);
  });

  it("ignores directions every vector in the corpus shares", () => {
    const shared = unit(D, [7]);
    const center = unit(D, [0, 7]);
    const g = fitGravity(center, [unit(D, [0, 7]), unit(D, [0, 1, 7])], corpusMean([shared, unit(D, [0, 7]), unit(D, [2, 7])], D));
    expect(g.g[7]).toBeLessThan(g.g[0]);
  });

  it("breaks a tie for a query in favor of the document nearer the person", () => {
    const grav = { center: unit(D, [0]), g: new Float32Array(D).fill(0.5), mass: 1 };
    const q = unit(D, [1]);
    const nearPerson = unit(D, [1, 0]);
    const farFromPerson = unit(D, [1, 5]);
    expect(dot(q, nearPerson)).toBeCloseTo(dot(q, farFromPerson));
    expect(gravityScore(q, nearPerson, grav)).toBeGreaterThan(gravityScore(q, farFromPerson, grav) + 0.05);
  });

  it("with no query, component weights rank by what the person cares about", () => {
    const g = new Float32Array(D);
    g[2] = 0.8;
    const grav = { center: unit(D, [1, 2]), g, mass: 1 };
    expect(gravityScore(grav.center, unit(D, [2]), grav)).toBeGreaterThan(gravityScore(grav.center, unit(D, [1]), grav));
  });

  it("falls off with distance: a far vector moves less than a near one", () => {
    const center = unit(D, [0]);
    const grav = { center, g: new Float32Array(D).fill(0.5), mass: 1 };
    const shift = (z: Float32Array) => {
      const p = pull(z, grav);
      return Math.sqrt(z.reduce((s, x, i) => s + (x - p[i]) ** 2, 0));
    };
    const r2 = (z: Float32Array) => z.reduce((s, x, i) => s + (x - center[i]) ** 2, 0);
    const near = unit(D, [0, 1]);
    const far = unit(D, [3, 4, 5]);
    expect(r2(far)).toBeGreaterThan(r2(near));
    expect(shift(far) / Math.sqrt(r2(far))).toBeLessThan(shift(near) / Math.sqrt(r2(near)));
  });

  it("the center does not move and output stays unit length", () => {
    const center = unit(D, [0, 3]);
    const grav = fitGravity(center, [], zero);
    expect([...pull(center, grav)].map((x) => +x.toFixed(5))).toEqual([...center].map((x) => +x.toFixed(5)));
    const p = pull(unit(D, [6]), grav);
    expect(dot(p, p)).toBeCloseTo(1);
  });

  it("round-trips through a blob", () => {
    const grav = fitGravity(unit(D, [1]), [unit(D, [1, 2]), unit(D, [1, 3])], zero);
    const back = unpackGravity(packGravity(grav));
    expect(back.mass).toBeCloseTo(grav.mass);
    expect([...back.center]).toEqual([...grav.center]);
    expect([...back.g]).toEqual([...grav.g]);
  });
});
