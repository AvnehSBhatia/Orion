import { describe, expect, it } from "vitest";
import { pca, scaleColumns } from "./projection";

describe("pca", () => {
  it("finds the main axes of spread and scales them into [-1, 1]", () => {
    // Points along (1, 1, 0, 0) with a little spread along (0, 0, 1, 0).
    const rows = Array.from({ length: 50 }, (_, i) => {
      const t = i - 25;
      const e = (i % 5) - 2;
      return [t, t, e * 0.1, 0];
    });
    const xyz = scaleColumns(pca(rows));
    expect(xyz).toHaveLength(50);
    for (const p of xyz) for (const v of p) expect(Math.abs(v)).toBeLessThanOrEqual(1);
    // First axis tracks t, second tracks e.
    const corr = (a: number[], b: number[]) => {
      const m = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
      const [ma, mb] = [m(a), m(b)];
      const cov = a.reduce((s, x, i) => s + (x - ma) * (b[i] - mb), 0);
      return cov / Math.sqrt(a.reduce((s, x) => s + (x - ma) ** 2, 0) * b.reduce((s, x) => s + (x - mb) ** 2, 0));
    };
    expect(Math.abs(corr(xyz.map((p) => p[0]), rows.map((r) => r[0])))).toBeGreaterThan(0.99);
    expect(Math.abs(corr(xyz.map((p) => p[1]), rows.map((r) => r[2])))).toBeGreaterThan(0.99);
    expect(xyz.every((p) => Number.isFinite(p[2]))).toBe(true);
  });

  it("is deterministic and handles tiny inputs", () => {
    const rows = [[1, 2, 3], [2, 1, 0], [0, 0, 1], [3, 3, 3]];
    expect(pca(rows)).toEqual(pca(rows));
    expect(pca([])).toEqual([]);
    expect(scaleColumns(pca([[1, 2]]))).toEqual([[0, 0, 0]]);
  });
});
