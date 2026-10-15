// Next-step actions: the model ends its answer with one ACTIONS line, held back from the stream and parsed here.
import type { ChatAction, PublicNode, Source } from "@/contract/types";
import { clamp, plain } from "@/lib/text";

export const ACTION_TAIL = "ACTIONS:";
const MAX_ACTIONS = 3;

/** Where the visible answer ends: before the ACTIONS line, holding back a partial "ACTIO" and trailing whitespace. */
export function visibleEnd(text: string): number {
  const at = text.indexOf(ACTION_TAIL);
  if (at >= 0) return text.slice(0, at).trimEnd().length;
  // Trailing whitespace waits too, so the line break before ACTIONS never streams.
  for (let n = Math.min(ACTION_TAIL.length - 1, text.length); n > 0; n--) {
    if (ACTION_TAIL.startsWith(text.slice(-n))) return text.slice(0, -n).trimEnd().length;
  }
  return text.trimEnd().length;
}

/** Splits the reply from its ACTIONS line. */
export function splitActions(text: string): { body: string; tail: string } {
  const at = text.indexOf(ACTION_TAIL);
  return at < 0 ? { body: text, tail: "" } : { body: text.slice(0, at).replace(/[\s*_]+$/, ""), tail: text.slice(at + ACTION_TAIL.length) };
}

const words = (text: string, n: number) => text.replace(/["'`*]/g, "").replace(/[?.:,;]+$/, "").trim().split(/\s+/).filter(Boolean).slice(0, n).join(" ");

/** Parses `open:S2 (Label) | ask:question (Label) | show:request (Label)` into at most 3 actions that point at real things. */
export function parseActions(
  tail: string,
  { sources, items, knownIds }: { sources: ReadonlyMap<string, Source>; items: readonly PublicNode[]; knownIds: ReadonlySet<string> },
): ChatAction[] {
  const out: ChatAction[] = [];
  for (const part of tail.split(/\s*\|\s*|\n+/)) {
    const m = part.trim().match(/^[-*\s]*(open|ask|show)\s*:\s*(.+?)\s*(?:\(([^()]*)\))?\s*$/i);
    if (!m) continue;
    const kind = m[1].toLowerCase() as ChatAction["kind"];
    const value = clamp(plain(m[2].replace(/^["']|["']$/g, "")), 200);
    let label = words(plain(m[3] ?? ""), 4);
    if (!value) continue;
    let action: ChatAction;
    if (kind === "open") {
      const handle = value.replace(/^\[|\]$/g, "").toUpperCase();
      const source = sources.get(handle);
      const node = knownIds.has(value) ? value : null;
      if (source) action = { kind, label: label || words(`Open ${source.title}`, 4), value: source.id, target: "source" };
      else if (node) action = { kind, label: label || words(`Open ${items.find((n) => n.id === node)?.label ?? node}`, 4), value: node, target: "node" };
      else continue;
    } else {
      if (!label) label = kind === "show" ? words(`Show ${value}`, 4) : words(value, 4);
      action = { kind, label, value };
    }
    if (label.split(/\s+/).length < 2 && kind !== "open") action.label = words(`${kind === "show" ? "Show" : "Ask"} ${label}`, 4);
    if (out.some((a) => a.kind === action.kind && a.value === action.value)) continue;
    out.push(action);
    if (out.length === MAX_ACTIONS) break;
  }
  return out;
}
