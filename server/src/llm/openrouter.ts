// OpenRouter chat completions: the one model provider. Callers depend only on the `LlmClient` shape.
import { config } from "@/config";
import { HttpError } from "@/http/error";

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

async function failed(res: Response): Promise<never> {
  console.error(`OpenRouter ${res.status}: ${(await res.text().catch(() => "")).slice(0, 500)}`);
  throw new HttpError(res.status === 429 ? 429 : 502, "model provider failed");
}

/** Models that rejected `reasoning: { enabled: false }`; requests to them omit it. */
const reasoningRequired = new Set<string>();

export class OpenRouterClient implements LlmClient {
  async complete(req: CompletionRequest): Promise<Completion> {
    const key = requireKey();
    const send = (reasoningOff: boolean) =>
      fetch(CHAT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "X-Title": "Orion",
        },
        // require_parameters: only route to providers that honor strict schemas.
        // Reasoning off: hidden thinking ate the token budget and made replies slow or empty.
        body: JSON.stringify({ ...(reasoningOff ? { reasoning: { enabled: false } } : {}), ...req, provider: { require_parameters: true } }),
      });
    let res: Response;
    try {
      res = await send(!reasoningRequired.has(req.model));
      // Some models refuse to run without reasoning; remember that and send it their way.
      if (res.status === 400 && !reasoningRequired.has(req.model)) {
        const body = await res.clone().text().catch(() => "");
        if (/reasoning is mandatory/i.test(body)) {
          reasoningRequired.add(req.model);
          res = await send(false);
        }
      }
    } catch (err) {
      console.error("OpenRouter unreachable", err);
      throw new HttpError(502, "model provider failed");
    }
    if (!res.ok) return failed(res);
    const json = (await res.json()) as Completion & { error?: { message?: string } };
    if (!json.choices?.length) {
      console.error("OpenRouter returned no choices", json.error?.message);
      throw new HttpError(502, "model provider failed");
    }
    return json;
  }
}

/** One completion with stream: true, read as server-sent events. Calls onDelta per text chunk; resolves with the whole text. */
export async function streamCompletion(req: CompletionRequest, onDelta: (text: string) => void): Promise<string> {
  const key = requireKey();
  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Orion" },
    // Reasoning would spend the small token budget before the answer starts.
    body: JSON.stringify({ ...req, stream: true, reasoning: { enabled: false } }),
  }).catch((err) => {
    console.error("OpenRouter unreachable", err);
    throw new HttpError(502, "model provider failed");
  });
  if (!res.ok || !res.body) return failed(res);
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return full;
      try {
        const delta = (JSON.parse(data) as { choices?: { delta?: { content?: string | null } }[] }).choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          onDelta(delta);
        }
      } catch {
        // keep-alive comments and partial lines
      }
    }
  }
  return full;
}

/**
 * One structured answer under a strict JSON schema. Retries once on unparseable output, then 422.
 * The result still goes through zod at the call site.
 */
export async function completeJson(
  llm: LlmClient,
  { model, name, schema, system, user, maxTokens = 3000 }: {
    model: string;
    name: string;
    schema: Record<string, unknown>;
    system: string;
    user: string;
    maxTokens?: number;
  },
): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await llm.complete({
      model,
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
      console.error(`Model returned non-JSON for ${name}: ${content.slice(0, 200)}`);
    }
  }
  throw new HttpError(422, `model did not return ${name}`);
}
