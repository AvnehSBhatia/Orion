import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmbedInput, Embedder } from "@/llm/embed";
import { IMAGE, prepareScreenshot, pruneImage, shrinkImage, visibleStretch, type OcrFn } from "./image";

const unit = (v: number[]) => {
  const n = Math.hypot(...v) || 1;
  return Float32Array.from(v, (x) => x / n);
};
const atSim = (s: number) => [s, Math.sqrt(1 - s * s), 0, 0];

class FakeEmbedder implements Embedder {
  readonly model = "fake@4";
  readonly calls: EmbedInput[][] = [];
  constructor(private readonly vec: (input: EmbedInput, call: number) => number[]) {}
  async embed(inputs: EmbedInput[]): Promise<Float32Array[]> {
    const call = this.calls.push(inputs) - 1;
    return inputs.map((i) => unit(this.vec(i, call)));
  }
}

const fakeOcr = (text: string, confidence = 90) => {
  const fn: OcrFn & { calls: number } = Object.assign(
    async () => {
      fn.calls++;
      return { text, confidence };
    },
    { calls: 0 },
  );
  return fn;
};

type Rect = { left: number; top: number; width: number; height: number; color: string };
const canvas = (width: number, height: number, rects: Rect[] = [], background = "#ffffff") =>
  sharp({ create: { width, height, channels: 3, background } })
    .composite(rects.map(({ color, ...r }) => ({ input: { create: { width: r.width, height: r.height, channels: 3 as const, background: color } }, left: r.left, top: r.top })))
    .png()
    .toBuffer();

const isWebp = (b: Buffer) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP";
const dims = async (b: Buffer) => {
  const { width, height } = await sharp(b).metadata();
  return { width: width!, height: height! };
};

const OCR_TEXT = "Voice latency weekly update. p95 dropped from 900 ms to 610 ms.";
const input = async (pageText = "Voice latency weekly update. p95 dropped from 900 ms to 610 ms.") => ({
  title: "Voice latency",
  pageText,
  image: await canvas(400, 300, [{ left: 40, top: 40, width: 320, height: 220, color: "#3b82f6" }]),
});

afterEach(() => vi.restoreAllMocks());

describe("prepareScreenshot", () => {
  it("stores text only when the OCR text says the same as the page", async () => {
    const e = new FakeEmbedder(() => [1, 0, 0, 0]);
    const res = await prepareScreenshot(e, await input(), fakeOcr(`  ${OCR_TEXT}\n\n\n\nFooter  \n`));
    expect(res).toMatchObject({ image: null, status: "text_only", ocrText: `${OCR_TEXT}\n\nFooter` });
    expect(res.ocrSim).toBeCloseTo(1);
    expect(e.calls).toHaveLength(1);
    expect(e.calls[0]).toHaveLength(2);
    expect(e.calls[0].every((i) => i.kind === "document" && !i.image)).toBe(true);
  });

  it("keeps a shrunk screenshot when the OCR text differs from the page", async () => {
    const e = new FakeEmbedder((i) => (i.text === OCR_TEXT ? [1, 0, 0, 0] : [0, 1, 0, 0]));
    const res = await prepareScreenshot(e, await input("Something else entirely on this page."), fakeOcr(OCR_TEXT));
    expect(res.status).toBe("kept");
    expect(res.ocrSim).toBeCloseTo(0);
    expect(res.ocrText).toBe(OCR_TEXT);
    expect(isWebp(res.image!)).toBe(true);
    expect(await dims(res.image!)).toEqual({ width: 320, height: 220 });
  });

  it("keeps the screenshot when OCR finds almost no text", async () => {
    const e = new FakeEmbedder(() => [1, 0, 0, 0]);
    const res = await prepareScreenshot(e, await input(), fakeOcr("Q4 chart"));
    expect(res).toMatchObject({ status: "kept", ocrSim: null, ocrText: "Q4 chart" });
    expect(isWebp(res.image!)).toBe(true);
    expect(e.calls).toHaveLength(0);
  });

  it("drops low-confidence OCR, which is what tesseract returns for photos", async () => {
    const e = new FakeEmbedder(() => [1, 0, 0, 0]);
    const res = await prepareScreenshot(e, await input(), fakeOcr("a\nAg WY TE\n. Re iy, Jos\nEN - BRL willy", 24));
    expect(res).toMatchObject({ status: "kept", ocrSim: null, ocrText: "" });
    expect(e.calls).toHaveLength(0);
  });

  it("keeps the screenshot when the page has no text of its own", async () => {
    const e = new FakeEmbedder(() => [1, 0, 0, 0]);
    const res = await prepareScreenshot(e, await input("  \n "), fakeOcr(OCR_TEXT));
    expect(res).toMatchObject({ status: "kept", ocrSim: null, ocrText: OCR_TEXT });
    expect(res.image).not.toBeNull();
    expect(e.calls).toHaveLength(0);
  });

  it("does not throw on a corrupt image", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const e = new FakeEmbedder(() => [1, 0, 0, 0]);
    const ocr = fakeOcr(OCR_TEXT);
    const res = await prepareScreenshot(e, { title: "x", pageText: "y", image: Buffer.from("not an image at all") }, ocr);
    expect(res).toEqual({ image: null, ocrText: "", status: "text_only", ocrSim: null });
    expect(ocr.calls).toBe(0);
    expect(console.warn).toHaveBeenCalledOnce();
  });
});

describe("visibleStretch", () => {
  const filler = (n: number, word: string) => Array.from({ length: n }, (_, i) => `${word}${i}`).join(" ");

  it("finds the part of a long page that the screenshot shows", () => {
    const shown = "Voice latency weekly update. p95 dropped from 900 ms to 610 ms after the buffer change.";
    const page = `${filler(400, "intro")} ${shown} ${filler(400, "outro")}`;
    const out = visibleStretch(page, `Menu Login\n${shown}`);
    expect(out).toContain("Voice latency weekly update");
    expect(out).toContain("610 ms");
    expect(out.length).toBeLessThan(shown.length * 2);
  });

  it("compares with the whole page when the page is about one screen long", () => {
    expect(visibleStretch("Short page about latency", "Short page about latency and more words here")).toBe("Short page about latency");
  });

  it("is used for the text only decision, so a long page with on-screen text drops its screenshot", async () => {
    const page = `${filler(500, "older")} ${OCR_TEXT} ${filler(500, "newer")}`;
    const e = new FakeEmbedder((i) => ((i as { text: string }).text.length > 1_000 ? [0, 1, 0, 0] : [1, 0, 0, 0]));
    const res = await prepareScreenshot(e, await input(page), fakeOcr(OCR_TEXT));
    expect(res.status).toBe("text_only");
  });
});

describe("shrinkImage", () => {
  it("fits within maxPixels, keeps the aspect ratio, and outputs webp", async () => {
    const out = await shrinkImage(await canvas(2000, 1500, [{ left: 0, top: 0, width: 1000, height: 750, color: "#10b981" }]));
    const { width, height } = await dims(out);
    expect(isWebp(out)).toBe(true);
    expect(width * height).toBeLessThanOrEqual(IMAGE.maxPixels);
    expect(width * height).toBeGreaterThan(IMAGE.maxPixels * 0.98);
    expect(width / height).toBeCloseTo(4 / 3, 2);
  });

  it("trims a uniform border", async () => {
    const out = await shrinkImage(await canvas(400, 300, [{ left: 30, top: 50, width: 300, height: 180, color: "#111827" }]));
    expect(await dims(out)).toEqual({ width: 300, height: 180 });
  });

  it("skips the trim when it would leave a tiny image", async () => {
    const dot = await shrinkImage(await canvas(400, 300, [{ left: 200, top: 150, width: 4, height: 4, color: "#000000" }]));
    expect(await dims(dot)).toEqual({ width: 400, height: 300 });
    const blank = await shrinkImage(await canvas(400, 300));
    expect(await dims(blank)).toEqual({ width: 400, height: 300 });
  });
});

describe("pruneImage", () => {
  // 250x250 of 16 colored tiles inside a 4px white frame; trim removes the frame, so tiles line up with the grid.
  const COLORS = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#84cc16"];
  const edges = [0, 1, 2, 3, 4].map((i) => Math.round((i * 250) / 4));
  const tiled = () =>
    canvas(
      258,
      258,
      [0, 1, 2, 3].flatMap((r) =>
        [0, 1, 2, 3].map((c) => ({
          left: 4 + edges[c],
          top: 4 + edges[r],
          width: edges[c + 1] - edges[c],
          height: edges[r + 1] - edges[r],
          color: COLORS[(r * 4 + c + r) % COLORS.length],
        })),
      ),
    );
  // Column 0 is least like the whole image.
  const tileSims = Array.from({ length: 16 }, (_, k) => (k % 4 === 0 ? 0.3 + k * 0.01 : 0.8));
  const embedder = (finalSim: number) =>
    new FakeEmbedder((_, call) => (call === 0 ? [1, 0, 0, 0] : call <= 16 ? atSim(tileSims[call - 1]) : atSim(finalSim)));

  it("leaves tiny images alone without embedding", async () => {
    const e = embedder(1);
    const res = await pruneImage(e, await canvas(100, 400, [{ left: 0, top: 0, width: 50, height: 400, color: "#3b82f6" }]));
    expect(res).toMatchObject({ status: "unchanged", dropped: 0, sim: null });
    expect(isWebp(res.image)).toBe(true);
    expect(e.calls).toHaveLength(0);
  });

  it("embeds each tile on its own, drops the least similar quarter, and shrinks the image", async () => {
    const e = embedder(0.97);
    const res = await pruneImage(e, await tiled());
    expect(res).toMatchObject({ status: "pruned", dropped: Math.round(16 * IMAGE.dropFraction) });
    expect(res.sim).toBeCloseTo(0.97);
    expect(res.ms).toBeGreaterThanOrEqual(0);
    expect(e.calls).toHaveLength(18);
    expect(e.calls.every((c) => c.length === 1 && c[0].kind === "document" && !!c[0].image)).toBe(true);
    const tiles = await Promise.all(e.calls.slice(1, 17).map((c) => dims(Buffer.from((c[0] as { image: string }).image, "base64"))));
    expect(tiles.reduce((s, t) => s + t.width * t.height, 0)).toBe(250 * 250);
    expect(isWebp(res.image)).toBe(true);
    expect(await dims(res.image)).toEqual({ width: 250 - edges[1], height: 250 });
  });

  it("keeps the original when the pruned image drifts too far", async () => {
    const res = await pruneImage(embedder(0.9), await tiled());
    expect(res).toMatchObject({ status: "unchanged", dropped: 0 });
    expect(res.sim).toBeCloseTo(0.9);
    expect(await dims(res.image)).toEqual({ width: 250, height: 250 });
  });
});
