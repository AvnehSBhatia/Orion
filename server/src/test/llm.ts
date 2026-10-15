import type { Completion, CompletionRequest, LlmClient } from "@/llm/openrouter";

type Turn = { content?: string | null };

/** Scripted OpenAI-compatible client: returns the queued turns in order and records every request. */
export function fakeLlm(turns: Turn[], { repeatLast = false } = {}) {
  const requests: CompletionRequest[] = [];
  let i = 0;
  const llm: LlmClient = {
    async complete(req) {
      requests.push(structuredClone(req));
      const turn = turns[Math.min(i++, turns.length - 1)];
      if (!turn || (!repeatLast && i > turns.length)) throw new Error("fakeLlm ran out of turns");
      return { choices: [{ finish_reason: "stop", message: { role: "assistant", content: turn.content ?? null } }] } satisfies Completion;
    },
  };
  return { llm, requests };
}

/** A completion whose content is this JSON, for structured-output calls. */
export const jsonTurn = (value: unknown): Turn => ({ content: JSON.stringify(value) });
