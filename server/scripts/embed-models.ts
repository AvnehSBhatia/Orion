// Downloads the local embedding model (EmbeddingGemma 2 ONNX, text and vision encoders, about 520MB at q8) into
// MODEL_CACHE_DIR, embeds one text to prove it loads, and exits. Run it at build or deploy time onto a persistent
// MODEL_CACHE_DIR so the first capture after a deploy does not wait for the download.
//
// Memory: loading the model takes about 1GB resident; an image embed peaks at about 2GB inside the API process.
// Size the box at 4 vCPU / 8GB minimum for EMBED_PROVIDER=gemma, and run the server under a process manager that
// restarts it on OOM (systemd Restart=always, or Docker restart: unless-stopped).
//
// Usage:
//   npm run embed-models                 download (or verify) the Gemma model, then exit
//   npm run embed-models -- --openrouter list the embedding model ids OpenRouter serves (needs OPENROUTER_API_KEY)

import path from "node:path";
import { config } from "@/config";
import { doc } from "@/llm/embed";
import { GemmaEmbedder } from "@/llm/gemma";

async function listOpenRouter(): Promise<void> {
  const res = await fetch("https://openrouter.ai/api/v1/embeddings/models", {
    headers: process.env.OPENROUTER_API_KEY ? { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` } : {},
  });
  if (!res.ok) throw new Error(`OpenRouter returned ${res.status}: ${await res.text()}`);
  const { data } = (await res.json()) as { data: { id: string; context_length?: number }[] };
  const google = (id: string) => /google|gemma|gemini/i.test(id);
  const sorted = [...data].sort((a, b) => Number(google(b.id)) - Number(google(a.id)) || a.id.localeCompare(b.id));
  for (const m of sorted) console.log(`${google(m.id) ? "*" : " "} ${m.id}${m.context_length ? `  (${m.context_length} tokens)` : ""}`);
}

async function prefetchGemma(): Promise<void> {
  const dir = path.resolve(config.modelCacheDir);
  console.log(`Fetching ${config.gemmaModel} (${config.gemmaDtype}) into ${dir} ...`);
  const t = performance.now();
  const embedder = new GemmaEmbedder();
  await embedder.warm();
  const [v] = await embedder.embed([doc("check", "Orion embedding model check.")]);
  if (!v || v.length !== 768 || !Number.isFinite(v[0])) throw new Error("the model loaded but returned a bad vector");
  const rss = Math.round(process.memoryUsage().rss / 1024 / 1024);
  console.log(`Ready in ${((performance.now() - t) / 1000).toFixed(1)}s (process memory ${rss}MB). Model cached in ${dir}.`);
}

try {
  if (process.argv.includes("--openrouter")) await listOpenRouter();
  else await prefetchGemma();
  process.exit(0);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
