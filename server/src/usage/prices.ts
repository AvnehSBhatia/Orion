/**
 * Fallback prices in USD per million tokens, [input, output], used only when OpenRouter's response carries no
 * `usage.cost`. Override or extend with LLM_PRICES='{"vendor/model":[0.1,0.4]}'; models missing from both use
 * LLM_DEFAULT_PRICE="in,out" (default 1,4: deliberately high, so an unknown model hits the budget early, not late).
 */
const BUILT_IN: Record<string, [number, number]> = {
  "google/gemini-2.5-flash-lite": [0.1, 0.4],
  "google/gemini-2.5-flash": [0.3, 2.5],
  "deepseek/deepseek-v4-flash": [0.3, 1.2],
  // DeepInfra fp8, the cheapest of the pinned hosts (MODEL_HOSTS in llm/http.ts).
  "deepseek/deepseek-v4.1-flash": [0.14, 0.42],
  "deepseek/deepseek-v4-pro": [0.6, 2.4],
  "google/gemini-embedding-2": [0.2, 0],
  "upstage/solar-mini4": [0.05, 0.2],
  "anthropic/claude-haiku-5.5": [0.1, 0.5],
};

function parsePrices(raw: string | undefined): Record<string, [number, number]> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, [number, number]> = {};
    for (const [model, v] of Object.entries(parsed)) {
      if (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && n >= 0)) out[model] = [v[0], v[1]];
    }
    return out;
  } catch {
    console.warn("LLM_PRICES is not valid JSON; using built-in prices");
    return {};
  }
}

function defaultPrice(): [number, number] {
  const [a, b] = (process.env.LLM_DEFAULT_PRICE ?? "").split(",").map(Number);
  return Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b >= 0 && process.env.LLM_DEFAULT_PRICE ? [a, b] : [1, 4];
}

/** [input, output] USD per million tokens for a model id (":variant" suffixes like ":nitro" match the base id). */
export function priceFor(model: string): [number, number] {
  const table = { ...BUILT_IN, ...parsePrices(process.env.LLM_PRICES) };
  return table[model] ?? table[model.split(":")[0]] ?? defaultPrice();
}

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const [pin, pout] = priceFor(model);
  return (inputTokens * pin + outputTokens * pout) / 1_000_000;
}
