import type { ChatMessage, Completion, CompletionRequest, LlmClient, ToolCall } from "@/llm/openrouter";

type Turn = { content?: string | null; toolCalls?: { name: string; args: unknown }[] };

/** Scripted OpenAI-compatible client: returns the queued turns in order and records every request. */
export function fakeLlm(turns: Turn[], { repeatLast = false } = {}) {
  const requests: CompletionRequest[] = [];
  let i = 0;
  const llm: LlmClient = {
    async complete(req) {
      requests.push(structuredClone(req));
      const turn = turns[Math.min(i++, turns.length - 1)];
      if (!turn || (!repeatLast && i > turns.length)) throw new Error("fakeLlm ran out of turns");
      const tool_calls: ToolCall[] | undefined = turn.toolCalls?.map((c, j) => ({
        id: `call_${i}_${j}`,
        type: "function",
        function: { name: c.name, arguments: JSON.stringify(c.args) },
      }));
      const message: Extract<ChatMessage, { role: "assistant" }> = { role: "assistant", content: turn.content ?? null, tool_calls };
      return { choices: [{ finish_reason: tool_calls?.length ? "tool_calls" : "stop", message }] } satisfies Completion;
    },
  };
  return { llm, requests };
}

/** A completion whose content is this JSON, for structured-output calls. */
export const jsonTurn = (value: unknown): Turn => ({ content: JSON.stringify(value) });
