// Lists the embedding model ids OpenRouter serves right now, Google ones first.
// Usage: OPENROUTER_API_KEY=... npm run embed-models

export {};

const res = await fetch("https://openrouter.ai/api/v1/embeddings/models", {
  headers: process.env.OPENROUTER_API_KEY ? { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` } : {},
});
if (!res.ok) {
  console.error(`OpenRouter returned ${res.status}: ${await res.text()}`);
  process.exit(1);
}

const { data } = (await res.json()) as { data: { id: string; context_length?: number }[] };
const google = (id: string) => /google|gemma|gemini/i.test(id);
const sorted = [...data].sort((a, b) => Number(google(b.id)) - Number(google(a.id)) || a.id.localeCompare(b.id));
for (const m of sorted) console.log(`${google(m.id) ? "*" : " "} ${m.id}${m.context_length ? `  (${m.context_length} tokens)` : ""}`);

const gemma = data.find((m) => /embeddinggemma/i.test(m.id));
console.log(
  gemma
    ? `\nEmbeddingGemma is available: set OPENROUTER_EMBED_MODEL=${gemma.id}`
    : "\nNo EmbeddingGemma id on OpenRouter. Keep OPENROUTER_EMBED_MODEL=google/gemini-embedding-2.",
);
