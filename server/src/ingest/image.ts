import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp, { type OutputInfo } from "sharp";
import type { Worker } from "tesseract.js";
import { config } from "@/config";
import { doc, type Embedder } from "@/llm/embed";

export const IMAGE = {
  ocrTextOnlySim: 0.95, // OCR text vs page text cosine at or above this: the screenshot adds nothing, store text only
  minOcrChars: 20, // less OCR text than this: the screenshot is visual, always keep it
  minOcrConfidence: 60, // tesseract reads text screenshots at ~90 and photos at ~25; below this the OCR is noise
  maxPixels: 645_120, // what the Gemma image processor actually uses
  webpQuality: 80,
  grid: 4, // background prune scans grid x grid crops
  dropFraction: 0.25, // drop this share of crops least like the whole image
  pruneKeepSim: 0.95, // adopt the pruned image only if its embedding stays this close to the original
} as const;

const TRIM_THRESHOLD = 8;
const MIN_TRIMMED_SIDE = 32;
const MIN_TILE_SIDE = 32;
const FLAT_BACKGROUND_SHARE = 0.2;

export type OcrResult = { text: string; confidence: number };
export type OcrFn = (image: Buffer) => Promise<OcrResult>;

let worker: Promise<Worker> | null = null;
let ocrQueue: Promise<unknown> = Promise.resolve();

function ocrWorker(): Promise<Worker> {
  return (worker ??= (async () => {
    // tesseract.js writes eng.traineddata here on first use but does not create the directory.
    const cachePath = path.resolve(config.modelCacheDir, "tesseract");
    await mkdir(cachePath, { recursive: true });
    const { createWorker } = await import("tesseract.js");
    const w = await createWorker("eng", undefined, { cachePath });
    // Screenshots carry no usable DPI; without this tesseract warns on every image and assumes 70.
    await w.setParameters({ user_defined_dpi: "72" });
    return w;
  })().catch((err) => {
    worker = null;
    throw err;
  }));
}

export function tesseractOcr(): OcrFn {
  return (image) => {
    const run = ocrQueue.then(async (): Promise<OcrResult> => {
      try {
        const { data } = await (await ocrWorker()).recognize(image);
        return { text: data.text, confidence: data.confidence };
      } catch (err) {
        console.warn(`OCR failed, continuing without screenshot text: ${(err as Error).message}`);
        return { text: "", confidence: 0 };
      }
    });
    ocrQueue = run;
    return run;
  };
}

type Raw = { data: Buffer; info: OutputInfo };
type Rgba = number[];

const decode = (image: Buffer): Promise<Raw> =>
  sharp(image).rotate().toColourspace("srgb").raw({ depth: "uchar" }).toBuffer({ resolveWithObject: true });

const fromRaw = ({ data, info: { width, height, channels } }: Raw) => sharp(data, { raw: { width, height, channels } });

async function trim(raw: Raw, background?: Rgba): Promise<Raw> {
  const bg = background && { r: background[0], g: background[1], b: background[2], alpha: (background[3] ?? 255) / 255 };
  try {
    const out = await fromRaw(raw).trim({ threshold: TRIM_THRESHOLD, background: bg }).raw().toBuffer({ resolveWithObject: true });
    if (out.info.width >= MIN_TRIMMED_SIDE && out.info.height >= MIN_TRIMMED_SIDE) return out;
  } catch {
    // Uniform images make trim throw; keep them as they are.
  }
  return raw;
}

function encode(raw: Raw): Promise<Buffer> {
  const { width, height } = raw.info;
  const scale = Math.min(1, Math.sqrt(IMAGE.maxPixels / (width * height)));
  return fromRaw(raw)
    .resize({
      width: Math.max(1, Math.floor(width * scale)),
      height: Math.max(1, Math.floor(height * scale)),
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: IMAGE.webpQuality })
    .toBuffer();
}

export async function shrinkImage(image: Buffer): Promise<Buffer> {
  return encode(await trim(await decode(image)));
}

const cosine = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * b[i], 0);
const cleanOcr = (text: string) =>
  text
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const wordsWithOffsets = (text: string) => [...text.matchAll(/[\p{L}\p{N}]{3,}/gu)].map((m) => ({ w: m[0].toLowerCase(), at: m.index }));

/**
 * The stretch of page text the screenshot shows. A screenshot covers one screen of a page that can be many screens
 * long, so the OCR text is compared with the run of page words that shares the most words with it.
 */
export function visibleStretch(pageText: string, ocrText: string): string {
  const ocrWords = new Set(wordsWithOffsets(ocrText).map((x) => x.w));
  const page = wordsWithOffsets(pageText);
  const span = Math.ceil(wordsWithOffsets(ocrText).length * 1.2);
  if (!ocrWords.size || page.length <= span) return pageText;
  const hit = page.map((x) => (ocrWords.has(x.w) ? 1 : 0));
  let run = hit.slice(0, span).reduce<number>((s, h) => s + h, 0);
  let best = { run, start: 0 };
  for (let i = 1; i + span <= page.length; i++) {
    run += hit[i + span - 1] - hit[i - 1];
    if (run > best.run) best = { run, start: i };
  }
  const last = page[best.start + span - 1];
  return pageText.slice(page[best.start].at, last.at + last.w.length);
}

export type PreparedScreenshot = { image: Buffer | null; ocrText: string; status: "text_only" | "kept"; ocrSim: number | null };

export async function prepareScreenshot(
  embedder: Embedder,
  input: { title: string; pageText: string; image: Buffer },
  ocr: OcrFn = tesseractOcr(),
): Promise<PreparedScreenshot> {
  let raw: Raw;
  try {
    raw = await decode(input.image);
  } catch (err) {
    console.warn(`Screenshot for "${input.title}" could not be decoded, storing text only: ${(err as Error).message}`);
    return { image: null, ocrText: "", status: "text_only", ocrSim: null };
  }
  const read = await ocr(await fromRaw(raw).png({ compressionLevel: 1 }).toBuffer());
  const ocrText = read.confidence >= IMAGE.minOcrConfidence ? cleanOcr(read.text) : "";
  const keep = async (ocrSim: number | null): Promise<PreparedScreenshot> => ({
    image: await encode(await trim(raw)),
    ocrText,
    status: "kept",
    ocrSim,
  });
  if (ocrText.length < IMAGE.minOcrChars || !input.pageText.trim()) return keep(null);
  const shown = visibleStretch(input.pageText, ocrText);
  const [ocrV, pageV] = await embedder.embed([doc(input.title, ocrText), doc(input.title, shown)]);
  const sim = cosine(ocrV, pageV);
  return sim >= IMAGE.ocrTextOnlySim ? { image: null, ocrText, status: "text_only", ocrSim: sim } : keep(sim);
}

function pixel({ data, info }: Raw, x: number, y: number): Rgba {
  const i = (y * info.width + x) * info.channels;
  return [...data.subarray(i, i + info.channels)];
}

function mostCommon(colors: Rgba[]): { color: Rgba; n: number } {
  const counts = new Map<string, { color: Rgba; n: number }>();
  for (const c of colors) {
    const key = c.map((v) => v >> 3).join();
    const hit = counts.get(key);
    if (hit) hit.n++;
    else counts.set(key, { color: c, n: 1 });
  }
  return [...counts.values()].reduce((a, b) => (b.n > a.n ? b : a));
}

// A page with a nav bar on top and a footer below splits its corners 2 and 2, so check the whole image for a flat
// background next. Photos have none (their most common color can be a black shadow), so use the border median.
function backgroundColor(raw: Raw): Rgba {
  const { width: w, height: h } = raw.info;
  const corners = mostCommon([pixel(raw, 0, 0), pixel(raw, w - 1, 0), pixel(raw, 0, h - 1), pixel(raw, w - 1, h - 1)]);
  if (corners.n >= 3) return corners.color;
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 40_000)));
  const sample: Rgba[] = [];
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) sample.push(pixel(raw, x, y));
  const flat = mostCommon(sample);
  if (flat.n >= sample.length * FLAT_BACKGROUND_SHARE) return flat.color;
  const border: Rgba[] = [];
  for (let x = 0; x < w; x++) border.push(pixel(raw, x, 0), pixel(raw, x, h - 1));
  for (let y = 1; y < h - 1; y++) border.push(pixel(raw, 0, y), pixel(raw, w - 1, y));
  return border[0].map((_, ch) => border.map((p) => p[ch]).sort((a, b) => a - b)[border.length >> 1]);
}

type Tile = { left: number; top: number; width: number; height: number };

function tiles(width: number, height: number, g: number): Tile[] {
  const xs = Array.from({ length: g + 1 }, (_, i) => Math.round((i * width) / g));
  const ys = Array.from({ length: g + 1 }, (_, i) => Math.round((i * height) / g));
  return ys.slice(0, g).flatMap((top, r) =>
    xs.slice(0, g).map((left, c) => ({ left, top, width: xs[c + 1] - left, height: ys[r + 1] - top })),
  );
}

function paint(raw: Raw, tile: Tile, color: Rgba) {
  const { width, channels } = raw.info;
  for (let y = tile.top; y < tile.top + tile.height; y++) {
    for (let x = tile.left; x < tile.left + tile.width; x++) {
      const i = (y * width + x) * channels;
      for (let ch = 0; ch < channels; ch++) raw.data[i + ch] = color[ch];
    }
  }
}

export type PruneResult = { image: Buffer; status: "pruned" | "unchanged"; dropped: number; sim: number | null; ms: number };

export async function pruneImage(embedder: Embedder, image: Buffer): Promise<PruneResult> {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const decoded = await decode(image);
  const bg = backgroundColor(decoded);
  const raw = await trim(decoded);
  const { width, height } = raw.info;
  const g = IMAGE.grid;
  if (width < g * MIN_TILE_SIDE || height < g * MIN_TILE_SIDE) {
    return { image: await encode(raw), status: "unchanged", dropped: 0, sim: null, ms: ms() };
  }
  const b64 = (buf: Buffer) => buf.toString("base64");
  const [whole] = await embedder.embed([doc(null, "", b64(await fromRaw(raw).png().toBuffer()))]);
  const scored: { tile: Tile; sim: number }[] = [];
  // One tile per embed call so other embed requests can run between tiles.
  for (const tile of tiles(width, height, g)) {
    const crop = await fromRaw(raw).extract(tile).png().toBuffer();
    const [v] = await embedder.embed([doc(null, "", b64(crop))]);
    scored.push({ tile, sim: cosine(whole, v) });
  }
  const drop = [...scored].sort((a, b) => a.sim - b.sim).slice(0, Math.round(g * g * IMAGE.dropFraction));
  const painted: Raw = { data: Buffer.from(raw.data), info: raw.info };
  for (const { tile } of drop) paint(painted, tile, bg);
  const pruned = await encode(await trim(painted, bg));
  const [pv] = await embedder.embed([doc(null, "", b64(pruned))]);
  const sim = cosine(whole, pv);
  if (sim >= IMAGE.pruneKeepSim) return { image: pruned, status: "pruned", dropped: drop.length, sim, ms: ms() };
  return { image: await encode(raw), status: "unchanged", dropped: 0, sim, ms: ms() };
}
