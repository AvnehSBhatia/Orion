// OpenRouter decision models (Drex, Jev): a state and typed questions in, a calibrated probability per option out,
// in one forward pass with no text generated. Cheap and fast enough to run on every message.
import { config } from "@/config";
import { HttpError } from "@/http/error";
import { logJson } from "@/jobs/log";
import { afterModelCall, beforeModelCall } from "@/usage";
import { fetchWithRetry, providerPrefs } from "./http";

const DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";

/** The most options one choice question takes. */
export const MAX_OPTIONS = 255;

/** Pick one of `criteria`'s keys; each value says when that option is right. */
export type ChoiceQuestion = { type: "choice"; instructions: string; criteria: Record<string, string> };
export type ChoiceAnswer = { choice: string; probabilities: Record<string, number> };

export type DecideRequest = { model: string; state: string | Record<string, unknown>; questions: Record<string, ChoiceQuestion> };
/** Answers keyed like the questions. */
export type Decide = (req: DecideRequest) => Promise<Record<string, ChoiceAnswer>>;

type DecisionsResponse = {
  answers?: Record<string, { choice?: unknown; probabilities?: unknown }>;
  usage?: { input_tokens?: number; output_tokens?: number; cost?: number };
};

/**
 * One decision call through OpenRouter. Billed to the org in context like a chat call. Short timeout and one retry:
 * callers fall back to the chat model rather than wait on a router.
 */
export const decide: Decide = async (req) => {
  const key = config.openRouterKey;
  if (!key) throw new HttpError(503, "OPENROUTER_API_KEY is not set on the backend");
  beforeModelCall();
  const { res } = await fetchWithRetry(
    DECISIONS_URL,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Orion" },
      body: JSON.stringify({ ...req, provider: providerPrefs(req.model) }),
    },
    { purpose: "chat", label: "decision", timeoutMs: config.routerTimeoutMs, retries: 1 },
  );
  if (!res.ok) {
    logJson("error", "openrouter decision failed", { model: req.model, status: res.status, detail: (await res.text().catch(() => "")).slice(0, 300) });
    throw new HttpError(502, "model provider failed");
  }
  const json = (await res.json()) as DecisionsResponse;
  const u = json.usage;
  if (u) afterModelCall({ model: req.model, kind: "chat", inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0, costUsd: u.cost ?? null });
  const out: Record<string, ChoiceAnswer> = {};
  for (const name of Object.keys(req.questions)) {
    const a = json.answers?.[name];
    if (!a || typeof a.choice !== "string" || !a.probabilities || typeof a.probabilities !== "object") {
      throw new HttpError(502, `decision model gave no answer to "${name}"`);
    }
    out[name] = { choice: a.choice, probabilities: a.probabilities as Record<string, number> };
  }
  return out;
};
