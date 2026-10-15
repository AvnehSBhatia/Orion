// One-line narrative for a draft entry, written by the model from the entry's evidence only. The text is not yet
// approved by anyone, so the call is zero-retention and metered; a quote or quoted phrase that is not verbatim in the
// evidence replaces the whole narrative with a stub.
import type { LlmClient } from "@/llm/openrouter";

export type NarrativeItem = { id: string; title: string; snippet: string | null };
export type Narrative = { narrative: string; quotes: Record<string, string>; stub: boolean };

const MAX_ITEMS = 20;
const MAX_SNIPPET = 400;
const MAX_LINE = 240;

export const stubNarrative = (clientName: string, count: number): string => `Work on ${clientName}: ${count} item${count === 1 ? "" : "s"}`;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** True when `quote` appears word for word (whitespace aside) in `text`. */
export const isVerbatim = (quote: string, text: string | null | undefined): boolean => {
  const q = squash(quote);
  return q.length > 0 && !!text && squash(text).includes(q);
};

function parse(text: string): { narrative?: unknown; quotes?: unknown } | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

/**
 * Asks the model for one line and optional verbatim quotes ({ narrative, quotes: [{ id, quote }] }). Any failure
 * (no model, budget, provider error, bad JSON, a quote not found in its snippet, a quoted phrase in the line that is
 * in no evidence) gives the stub.
 */
export async function writeNarrative(llm: LlmClient | null, model: string, clientName: string, items: NarrativeItem[]): Promise<Narrative> {
  const stub: Narrative = { narrative: stubNarrative(clientName, items.length), quotes: {}, stub: true };
  if (!llm || items.length === 0) return stub;
  const used = items.slice(0, MAX_ITEMS);
  const evidence = used.map((i) => ({ id: i.id, title: i.title.slice(0, 200), snippet: (i.snippet ?? "").slice(0, MAX_SNIPPET) }));
  try {
    const res = await llm.complete({
      model,
      purpose: "chat",
      zdr: true,
      temperature: 0,
      max_tokens: 300,
      messages: [
        {
          role: "system",
          content:
            "You write one line (under 25 words, past tense, no first person) describing billable work from the evidence items. " +
            "Use only facts in the evidence. If you quote text, copy it exactly from an item's snippet. " +
            'Reply with JSON only: {"narrative": string, "quotes": [{"id": string, "quote": string}]} (quotes may be empty).',
        },
        { role: "user", content: `Client: ${clientName}\nEvidence:\n${JSON.stringify(evidence)}` },
      ],
    });
    const parsed = parse(res.choices[0]?.message.content ?? "");
    const line = typeof parsed?.narrative === "string" ? squash(parsed.narrative) : "";
    if (!line || line.length > MAX_LINE) return stub;
    const quotes: Record<string, string> = {};
    if (Array.isArray(parsed?.quotes)) {
      for (const q of parsed.quotes as { id?: unknown; quote?: unknown }[]) {
        if (typeof q?.id !== "string" || typeof q?.quote !== "string" || !q.quote.trim()) continue;
        const item = used.find((i) => i.id === q.id);
        if (!item || !isVerbatim(q.quote, item.snippet)) return stub;
        quotes[q.id] = squash(q.quote).slice(0, 300);
      }
    }
    // A phrase in double quotes inside the line must come from the evidence too.
    for (const m of line.matchAll(/["“]([^"”]{2,})["”]/g)) {
      if (!used.some((i) => isVerbatim(m[1], i.snippet) || isVerbatim(m[1], i.title))) return stub;
    }
    return { narrative: line, quotes, stub: false };
  } catch {
    return stub;
  }
}
