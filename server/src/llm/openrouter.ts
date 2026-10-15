// OpenRouter chat completions: the one model provider. Callers depend only on the `LlmClient` shape.
import { config } from "@/config";
import { HttpError } from "@/http/error";
import { logJson } from "@/jobs/log";
import { afterModelCall, beforeModelCall, readUsage } from "@/usage";
import { NoRetry, fetchWithRetry, isTimeout, providerPrefs } from "./http";

const CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

export type ChatMessage = { role: "system" | "user"; content: string } | { role: "assistant"; content: string | null };

export type Completion = {
  choices: { finish_reason: string | null; message: Extract<ChatMessage, { role: "assistant" }> }[];
};

export type CompletionRequest = {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  response_format?: { type: "json_schema"; json_schema: { name: string; strict: true; schema: Record<string, unknown> } };
  /** Picks the timeout (chat 45s, extract 60s by default) and the usage bucket. Not sent to the provider. */
  purpose?: "chat" | "extract";
  /**
   * Zero data retention: routed only to providers that keep nothing (`provider.zdr`), and a failure logs the
   * status alone, not the provider's error body. For text a person has not approved yet. Not sent as is.
   */
  zdr?: boolean;
};

/** OpenAI-compatible chat completions, the only shape callers depend on. */
export interface LlmClient {
  complete(req: CompletionRequest): Promise<Completion>;
}

/** A JSON schema that also allows null (strict mode requires every field, so optional ones are nullable). */
export const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });

function requireKey(): string {
  const key = config.openRouterKey;
  if (!key) throw new HttpError(503, "OPENROUTER_API_KEY is not set on the backend");
  return key;
}

async function failed(res: Response, zdr = false): Promise<never> {
  // Provider error bodies only: never the prompt or the model's output, which can hold captured page text.
  // A zero-retention call logs no body at all, since a provider may echo the prompt in its error.
  const detail = zdr ? undefined : (await res.text().catch(() => "")).slice(0, 300);
  logJson("error", "openrouter request failed", { status: res.status, ...(detail !== undefined && { detail }) });
  throw new HttpError(res.status === 429 ? 429 : 502, "model provider failed");
}

const headers = (key: string) => ({ Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Orion" });

/** The request as sent: our routing and privacy settings, usage accounting on, internal fields dropped. */
export function requestBody(req: CompletionRequest, extra: Record<string, unknown>): string {
  const { purpose: _purpose, zdr, ...rest } = req;
  const provider = zdr ? { ...providerPrefs(), zdr: true, data_collection: "deny" } : providerPrefs();
  return JSON.stringify({ ...extra, ...rest, provider, usage: { include: true } });
}

/** Models that rejected `reasoning: { enabled: false }`; requests to them omit it. */
const reasoningRequired = new Set<string>();

/**
 * Chat completions through OpenRouter: a timeout per attempt, retries with backoff on 429, 5xx and network errors,
 * and (inside `withUsage`) the org's budget checked before the call and its usage recorded after.
 */
export class OpenRouterClient implements LlmClient {
  async complete(req: CompletionRequest): Promise<Completion> {
    const key = requireKey();
    beforeModelCall();
    const purpose = req.purpose ?? "chat";
    const send = (reasoningOff: boolean) =>
      fetchWithRetry(
        CHAT_URL,
        {
          method: "POST",
          headers: headers(key),
          // Reasoning off: hidden thinking ate the token budget and made replies slow or empty.
          body: requestBody(req, reasoningOff ? { reasoning: { enabled: false } } : {}),
        },
        { purpose, label: purpose, quiet: req.zdr },
      );
    let { res } = await send(!reasoningRequired.has(req.model));
    // Some models refuse to run without reasoning; remember that and send it their way.
    if (res.status === 400 && !reasoningRequired.has(req.model)) {
      const text = await res.clone().text().catch(() => "");
      if (/reasoning is mandatory/i.test(text)) {
        reasoningRequired.add(req.model);
        ({ res } = await send(false));
      }
    }
    if (!res.ok) return failed(res, req.zdr);
    const json = (await res.json()) as Completion & { error?: { message?: string }; usage?: unknown };
    const usage = readUsage(json.usage);
    if (usage) afterModelCall({ model: req.model, kind: purpose, ...usage });
    if (!json.choices?.length) {
      logJson("error", "openrouter returned no choices", { model: req.model, ...(!req.zdr && { detail: json.error?.message?.slice(0, 200) }) });
      throw new HttpError(502, "model provider failed");
    }
    return json;
  }
}

/**
 * One completion with stream: true, read as server-sent events. Calls onDelta per text chunk; resolves with the whole text.
 * Retries like `complete` until the first chunk of text has been passed on; after that a failure ends the reply.
 */
export async function streamCompletion(req: CompletionRequest, onDelta: (text: string) => void): Promise<string> {
  const key = requireKey();
  beforeModelCall();
  const purpose = req.purpose ?? "chat";
  let usage: ReturnType<typeof readUsage> = null;
  const read = async (res: Response): Promise<string> => {
    if (!res.body) throw new HttpError(502, "model provider failed");
    const decoder = new TextDecoder();
    let buf = "";
    let full = "";
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buf += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") return full;
          let parsed: { choices?: { delta?: { content?: string | null } }[]; usage?: unknown };
          try {
            parsed = JSON.parse(data);
          } catch {
            continue; // keep-alive comments and partial lines
          }
          if (parsed.usage) usage = readUsage(parsed.usage);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            onDelta(delta);
          }
        }
      }
    } catch (err) {
      // Text already reached the caller: a retry would repeat it, so fail instead.
      if (full) throw new NoRetry(isTimeout(err) ? new HttpError(504, "model provider timed out") : new HttpError(502, "model provider failed"));
      throw err;
    }
    return full;
  };
  try {
    const { res, body } = await fetchWithRetry(
      CHAT_URL,
      // Reasoning would spend the small token budget before the answer starts.
      { method: "POST", headers: headers(key), body: requestBody(req, { stream: true, reasoning: { enabled: false } }) },
      { purpose, label: `${purpose} stream`, read },
    );
    if (!res.ok) return failed(res);
    return body as string;
  } finally {
    const u = usage as ReturnType<typeof readUsage>;
    if (u) afterModelCall({ model: req.model, kind: purpose, ...u });
  }
}

/**
 * One structured answer under a strict JSON schema. Retries once on unparseable output, then 422.
 * The result still goes through zod at the call site.
 */
export async function completeJson(
  llm: LlmClient,
  { model, name, schema, system, user, maxTokens = 3000, purpose }: {
    model: string;
    name: string;
    schema: Record<string, unknown>;
    system: string;
    user: string;
    maxTokens?: number;
    purpose?: CompletionRequest["purpose"];
  },
): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await llm.complete({
      model,
      ...(purpose && { purpose }),
      max_tokens: maxTokens,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
    });
    const content = res.choices[0].message.content?.trim();
    if (!content) continue;
    try {
      return JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch {
      logJson("warn", "model returned non-JSON", { name, model, chars: content.length });
    }
  }
  throw new HttpError(422, `model did not return ${name}`);
}
