// Cost of the in-process Gemma embedder per item on this machine: npx tsx scripts/bench-embed.ts
import sharp from "sharp";
import { doc, query } from "@/llm/embed";
import { GemmaEmbedder } from "@/llm/gemma";

const g = new GemmaEmbedder();
let t = performance.now();
await g.warm();
console.log(`load ${(performance.now() - t).toFixed(0)} ms, rss ${(process.memoryUsage().rss / 1e6).toFixed(0)} MB`);
const page = "Working on the checkout flow and payment retries for the EU launch. ".repeat(30);
const run = async (label: string, n: number, make: (i: number) => Parameters<GemmaEmbedder["embed"]>[0][number]) => {
  await g.embed([make(-1)]);
  t = performance.now();
  await g.embed(Array.from({ length: n }, (_, i) => make(i)));
  const ms = performance.now() - t;
  console.log(`${label.padEnd(36)} ${(ms / n).toFixed(0).padStart(6)} ms/item  (${n} items)`);
};
await run("query (short)", 32, (i) => query(`what is blocking checkout ${i}`));
await run("node (label + summary)", 32, (i) => doc(`Item ${i}`, "Checkout retries are blocked on the payments API rate limit."));
await run("page text (~2k chars)", 16, (i) => doc(`Page ${i}`, page + i));
const shot = (await sharp({ create: { width: 1600, height: 1000, channels: 3, background: "#f4f4f4" } })
  .composite([{ input: Buffer.from(`<svg width="1600" height="1000"><text x="40" y="80" font-size="40">Checkout dashboard</text><rect x="40" y="140" width="700" height="400" fill="#36c"/></svg>`) }])
  .jpeg().toBuffer()).toString("base64");
await run("page text + screenshot", 4, (i) => doc(`Shot ${i}`, page + i, shot));
console.log(`rss ${(process.memoryUsage().rss / 1e6).toFixed(0)} MB`);
