/**
 * Reference vectors for the Rust port, from the TypeScript GemmaEmbedder (Transformers.js + onnxruntime-node).
 *
 * Run from the main repo so `@/` imports and node_modules resolve:
 *   cd /Users/avneh/Code/Orion && npx tsx <worktree>/server/gemma/parity/ref.ts
 *
 * Writes parity/images/* (deterministic test images) and parity/reference.json (inputs + vectors + TS timings).
 * DEBUG_DIR=<dir> also dumps the processor output (input_ids, pixel_values, positions) of each image doc.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const here = path.dirname(new URL(import.meta.url).pathname);
const imagesDir = path.join(here, "images");
fs.mkdirSync(imagesDir, { recursive: true });

type RefInput =
  | { kind: "query"; text: string; context?: string | null }
  | { kind: "document"; title: string | null; text: string; image?: string | null; context?: string | null };

// ---------- deterministic test images ----------

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function screenshotSvg(w: number, h: number, title: string): string {
  const rand = rng(7);
  const lines: string[] = [];
  let y = 120;
  const words = "deploy pipeline failed on staging because the migration locked the users table for twelve minutes".split(" ");
  while (y < h - 40) {
    const n = 6 + Math.floor(rand() * 8);
    const text = Array.from({ length: n }, () => words[Math.floor(rand() * words.length)]).join(" ");
    lines.push(`<text x="260" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="18" fill="#1f2328">${text}</text>`);
    y += 30;
  }
  const side = Array.from({ length: 12 }, (_, i) =>
    `<text x="24" y="${130 + i * 34}" font-family="Helvetica, Arial, sans-serif" font-size="16" fill="#e6edf3"># channel-${i}</text>`,
  ).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#ffffff"/>
    <rect width="${w}" height="56" fill="#24292f"/>
    <text x="24" y="36" font-family="Helvetica, Arial, sans-serif" font-size="22" fill="#ffffff">${title}</text>
    <rect y="56" width="230" height="${h - 56}" fill="#1b1f24"/>
    ${side}
    <rect x="250" y="76" width="${w - 270}" height="2" fill="#d0d7de"/>
    ${lines.join("\n")}
    <rect x="${w - 200}" y="${h - 70}" width="170" height="44" rx="8" fill="#2da44e"/>
    <text x="${w - 160}" y="${h - 41}" font-family="Helvetica, Arial, sans-serif" font-size="18" fill="#ffffff">Merge PR</text>
  </svg>`;
}

/** Photo-like: smooth radial/linear gradients plus per-pixel noise. */
function gradientRgb(w: number, h: number): Buffer {
  const rand = rng(42);
  const buf = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x / w - 0.35, dy = y / h - 0.4;
      const r = Math.sqrt(dx * dx + dy * dy);
      const sky = y / h;
      const n = (rand() - 0.5) * 18;
      const i = (y * w + x) * 3;
      buf[i] = Math.max(0, Math.min(255, 255 * (1 - r) * 0.9 + 40 * sky + n));
      buf[i + 1] = Math.max(0, Math.min(255, 120 + 100 * Math.sin(x / 47) * (1 - sky) + n));
      buf[i + 2] = Math.max(0, Math.min(255, 200 * sky + 30 * Math.cos(y / 23) + n));
    }
  }
  return buf;
}

async function makeImages(): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const screenshot = path.join(imagesDir, "screenshot.png");
  await sharp(Buffer.from(screenshotSvg(1280, 800, "orion / incidents / #4821"))).png().toFile(screenshot);
  files.screenshot = "screenshot.png";

  const gradient = path.join(imagesDir, "gradient.jpg");
  await sharp(gradientRgb(1024, 768), { raw: { width: 1024, height: 768, channels: 3 } }).jpeg({ quality: 88 }).toFile(gradient);
  files.gradient = "gradient.jpg";

  // Small RGBA image: exercises alpha dropping and the 0-height resize branch (50x30 -> 48x48? see processor).
  const small = Buffer.alloc(50 * 30 * 4);
  for (let y = 0; y < 30; y++)
    for (let x = 0; x < 50; x++) {
      const i = (y * 50 + x) * 4;
      small[i] = x * 5;
      small[i + 1] = y * 8;
      small[i + 2] = (x + y) % 2 ? 220 : 30;
      small[i + 3] = 128 + ((x * 3) % 128);
    }
  await sharp(small, { raw: { width: 50, height: 30, channels: 4 } }).png().toFile(path.join(imagesDir, "small.png"));
  files.small = "small.png";

  await sharp(Buffer.from(screenshotSvg(1920, 1080, "Quarterly planning - roadmap board")))
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 90 })
    .toFile(path.join(imagesDir, "wide.jpg"));
  files.wide = "wide.jpg";
  return files;
}

// ---------- inputs ----------

function longText(): string {
  const rand = rng(1234);
  const vocab = (
    "the incident review covered database failover latency budget on-call rotation customer impact rollback plan " +
    "postgres replication lag alerting threshold dashboard owners runbook escalation policy capacity forecast " +
    "kubernetes node pool autoscaler regression canary deploy feature flag cleanup security audit token rotation"
  ).split(" ");
  const sentences: string[] = [];
  for (let i = 0; i < 700; i++) {
    const n = 8 + Math.floor(rand() * 10);
    const s = Array.from({ length: n }, () => vocab[Math.floor(rand() * vocab.length)]).join(" ");
    sentences.push(s[0].toUpperCase() + s.slice(1) + (i % 5 === 4 ? ".\n" : "."));
  }
  return sentences.join(" ");
}

type Case = { name: string; input: RefInput; imageFile?: string };

function cases(images: Record<string, string>): Case[] {
  const b64 = (f: string) => fs.readFileSync(path.join(imagesDir, f)).toString("base64");
  const long = longText();
  const c: Case[] = [
    { name: "q_plain", input: { kind: "query", text: "why did the staging deploy fail last night?" } },
    { name: "q_context", input: { kind: "query", text: "who owns the billing service?", context: "Senior SRE, platform team" } },
    { name: "q_short", input: { kind: "query", text: "OKRs" } },
    { name: "q_unicode", input: { kind: "query", text: "Résumé of the café meeting — naïve estimates ≈ 3× over budget 🚀", context: "" } },
    { name: "q_pipes", input: { kind: "query", text: "status | owner | eta for <bos> migration", context: "PM | growth" } },
    { name: "d_title", input: { kind: "document", title: "Postmortem: staging outage", text: "The migration locked the users table for twelve minutes, blocking all writes." } },
    { name: "d_notitle", input: { kind: "document", title: null, text: "Lunch is at noon on Friday in the big conference room." } },
    { name: "d_context", input: { kind: "document", title: "Q3 roadmap | draft", text: "We will ship SSO, audit logs, and the new billing page.", context: "VP Engineering" } },
    { name: "d_whitespace_title", input: { kind: "document", title: "   ", text: "  leading and trailing spaces  \n\n\tand tabs " } },
    { name: "d_image_literal", input: { kind: "document", title: "Template <|image|> notes", text: "Paste a screenshot here: <|image|> and audio <|audio|> or <|video|>." } },
    { name: "d_long", input: { kind: "document", title: "Long incident review", text: long } },
    { name: "d_img_screenshot", input: { kind: "document", title: "Incident channel screenshot", text: "Screenshot of the incident thread about the staging deploy.", image: b64(images.screenshot) }, imageFile: images.screenshot },
    { name: "d_img_gradient", input: { kind: "document", title: "Sunset photo", text: "A photo from the team offsite.", image: b64(images.gradient), context: "Office manager" }, imageFile: images.gradient },
    { name: "d_img_small", input: { kind: "document", title: null, text: "tiny icon", image: b64(images.small) }, imageFile: images.small },
    { name: "d_img_wide", input: { kind: "document", title: "Roadmap board", text: "Planning board for next quarter.", image: "data:image/jpeg;base64," + b64(images.wide) }, imageFile: images.wide },
    { name: "d_img_long", input: { kind: "document", title: "Long doc with screenshot", text: long, image: b64(images.screenshot) }, imageFile: images.screenshot },
    { name: "d_img_broken", input: { kind: "document", title: "Broken image", text: "This image does not decode.", image: Buffer.from("definitely not an image").toString("base64") } },
  ];
  // Fill out to more than one text batch of 16.
  for (let i = 0; i < 6; i++) {
    c.push({ name: `q_fill_${i}`, input: { kind: "query", text: `filler question number ${i} about sprint ${i * 3} velocity` } });
  }
  return c;
}

// ---------- main ----------

async function main() {
  const { GemmaEmbedder } = await import(path.join(process.cwd(), "src/llm/gemma.ts"));
  const images = await makeImages();
  const all = cases(images);
  const emb = new GemmaEmbedder();
  const t0 = performance.now();
  const loaded = await emb.warm();
  const loadMs = performance.now() - t0;

  const vectors: Float32Array[] = await emb.embed(all.map((c) => c.input));

  const debugDir = process.env.DEBUG_DIR;
  if (debugDir) {
    fs.mkdirSync(debugDir, { recursive: true });
    const { gemmaText } = await import(path.join(process.cwd(), "src/llm/gemma.ts"));
    const tf = await import("@huggingface/transformers");
    for (const c of all) {
      if (c.input.kind !== "document" || !c.imageFile) continue;
      const raw = await tf.RawImage.fromBlob(new Blob([fs.readFileSync(path.join(imagesDir, c.imageFile))]));
      let text = gemmaText(c.input);
      const ids = loaded.tokenizer.encode(text, { add_special_tokens: false });
      if (ids.length > 2048 - 280 - 8) text = loaded.tokenizer.decode(ids.slice(0, 2048 - 280 - 8), { skip_special_tokens: true });
      const enc = (await loaded.processor([`${text} <|image|>`], [[raw]])) as Record<string, { data: ArrayLike<number | bigint>; dims: number[] }>;
      fs.writeFileSync(path.join(debugDir, `${c.name}.text.txt`), text);
      fs.writeFileSync(path.join(debugDir, `${c.name}.ids.json`), JSON.stringify(Array.from(enc.input_ids.data, Number)));
      const pv = enc.pixel_values;
      fs.writeFileSync(path.join(debugDir, `${c.name}.pixels.f32`), Buffer.from(new Float32Array(pv.data as Float32Array).buffer));
      fs.writeFileSync(path.join(debugDir, `${c.name}.meta.json`), JSON.stringify({ dims: pv.dims, raw: [raw.width, raw.height, raw.channels] }));
    }
    for (const c of all) {
      if (c.imageFile) continue;
      const ids = loaded.tokenizer([gemmaText(c.input)], { padding: true, truncation: true, max_length: 2048 }).input_ids as { data: BigInt64Array };
      fs.writeFileSync(path.join(debugDir, `${c.name}.ids.json`), JSON.stringify(Array.from(ids.data, Number)));
    }
  }

  // Timings: a full text batch of 16 and single image documents.
  const textBatch = all.filter((c) => !c.imageFile && c.name !== "d_long").slice(0, 16).map((c) => c.input);
  const reps = Number(process.env.REPS ?? 5);
  const time = async (fn: () => Promise<unknown>) => {
    await fn();
    const ts: number[] = [];
    for (let i = 0; i < reps; i++) {
      const s = performance.now();
      await fn();
      ts.push(performance.now() - s);
    }
    ts.sort((a, b) => a - b);
    return { median: ts[Math.floor(ts.length / 2)], min: ts[0] };
  };
  const timings: Record<string, { median: number; min: number }> = {};
  timings.text_batch16 = await time(() => emb.embed(textBatch));
  timings.long_doc = await time(() => emb.embed([all.find((c) => c.name === "d_long")!.input]));
  for (const c of all.filter((c) => c.imageFile && c.name !== "d_img_long")) {
    timings[c.name] = await time(() => emb.embed([c.input]));
  }

  const out = {
    model: emb.model,
    load_ms: loadMs,
    timings_ms: timings,
    cases: all.map((c, i) => ({
      name: c.name,
      input: c.input.kind === "document" && c.input.image ? { ...c.input, image: undefined, image_file: c.imageFile ?? null, image_data_uri: c.input.image.startsWith("data:"), image_b64: c.imageFile ? undefined : c.input.image } : c.input,
      vector: Array.from(vectors[i]),
    })),
  };
  fs.writeFileSync(path.join(here, "reference.json"), JSON.stringify(out));
  console.log(JSON.stringify({ model: out.model, load_ms: loadMs, timings_ms: timings }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
