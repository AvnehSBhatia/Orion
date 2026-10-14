import { config } from "@/config";
import { HttpError } from "@/http/error";

const CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[]; [extra: string]: unknown }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown>; strict: true };
};

export type Completion = {
  choices: { finish_reason: string | null; message: Extract<ChatMessage, { role: "assistant" }> }[];
};

export type CompletionRequest = {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  tools?: ToolDef[];
  tool_choice?: "auto" | "none" | "required";
  response_format?: { type: "json_schema"; json_schema: { name: string; strict: true; schema: Record<string, unknown> } };
};

/** OpenAI-compatible chat completions, the only shape callers depend on. */
export interface LlmClient {
  complete(req: CompletionRequest): Promise<Completion>;
}

export const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });

export function tool(name: string, description: string, parameters: Record<string, unknown>): ToolDef {
  return { type: "function", function: { name, description, parameters, strict: true } };
}

/** Models that rejected `reasoning: { enabled: false }`; requests to them omit it. */
const reasoningRequired = new Set<string>();

export class OpenRouterClient implements LlmClient {
  async complete(req: CompletionRequest): Promise<Completion> {
    const key = config.openRouterKey;
    if (!key) throw new HttpError(503, "OPENROUTER_API_KEY is not set on the backend");
    const send = (reasoningOff: boolean) =>
      fetch(CHAT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "X-Title": "Orion",
        },
        // require_parameters: only route to providers that honor tools and strict schemas.
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
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`OpenRouter ${res.status}: ${body.slice(0, 500)}`);
      throw new HttpError(res.status === 429 ? 429 : 502, "model provider failed");
    }
    const json = (await res.json()) as Completion & { error?: { message?: string } };
    if (!json.choices?.length) {
      console.error("OpenRouter returned no choices", json.error?.message);
      throw new HttpError(502, "model provider failed");
    }
    return json;
  }
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
