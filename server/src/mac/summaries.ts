// POST /v1/summaries: a short "you did this" line for the Mac's Outbox. Nothing is stored and nothing is logged.
import { z } from "zod";
import { config } from "@/config";
import type { LlmClient } from "@/llm/openrouter";
import { blockSchema } from "./workBlocks";

export const SUMMARY_MAX = 600;
const summaryBlock = blockSchema
  .pick({ app_name: true, window_title: true, domain_path: true, snippet: true })
  .extend({ snippet: blockSchema.shape.snippet.optional() });
export const summariesRequest = z.object({ blocks: z.array(summaryBlock).min(1).max(100) });
export type SummaryBlock = z.infer<typeof summaryBlock>;

const PROMPT = `You write one to three sentences, second person, past tense, describing what a person did, from the on-screen items below ("You read Apple's sign-in alert, then checked Initech's pricing page."). Keep markers like [PHONE] exactly as they are. Use only the items given. Under ${SUMMARY_MAX} characters. Reply with the sentences only.`;

/** The no-model answer: the distinct titles in order. */
export function titlesSummary(blocks: SummaryBlock[]): string {
  const titles = [...new Set(blocks.map((b) => (b.window_title || b.app_name).trim()).filter(Boolean))];
  const out: string[] = [];
  let len = 0;
  for (const t of titles) {
    if (len + t.length + 2 > SUMMARY_MAX - 20) break;
    out.push(t);
    len += t.length + 2;
  }
  const rest = titles.length - out.length;
  return (out.join("; ") || "Work") + (rest > 0 ? `; and ${rest} more` : "");
}

/**
 * Zero-retention model call (`zdr`: provider `{ zdr: true, data_collection: "deny" }`, no error bodies logged).
 * Without a key, over budget, or on any failure it falls back to the titles. Never throws, stores nothing.
 */
export async function summarize(llm: LlmClient | null, blocks: SummaryBlock[]): Promise<string> {
  if (!llm) return titlesSummary(blocks);
  const items = blocks
    .map((b, i) => `${i + 1}. ${b.app_name}: ${b.window_title}${b.domain_path ? ` (${b.domain_path})` : ""}${b.snippet ? `\n${b.snippet.slice(0, 400)}` : ""}`)
    .join("\n");
  try {
    const res = await llm.complete({
      model: config.chatModel,
      zdr: true,
      purpose: "chat",
      max_tokens: 300,
      temperature: 0.2,
      messages: [
        { role: "system", content: PROMPT },
        { role: "user", content: items },
      ],
    });
    const text = res.choices[0]?.message.content?.trim();
    return text ? text.slice(0, SUMMARY_MAX) : titlesSummary(blocks);
  } catch {
    return titlesSummary(blocks);
  }
}
