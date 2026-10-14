import { describe, expect, it, vi } from "vitest";
import type { Source } from "@/contract/types";
import { fakeLlm } from "@/test/llm";
import { parseActions, visibleEnd } from "./actions";
import { LlmChat, sanitizeView, type ChatInput } from "./model";

const user = { id: "sam", name: "Sam Ortiz", role: "Account executive. Deals and renewals.", teamDescription: "" };
const knownIds = new Set(["voice-mode", "sso-login"]);
const source = (id: string, title: string): Source => ({
  id,
  kind: "extension",
  ref: `https://example.com/${id}`,
  title,
  excerpt: `${title} excerpt`,
  authorId: "devon",
  authorName: "Devon Park",
  createdAt: "2026-10-10T10:00:00.000Z",
  hasImage: false,
  changes: [{ nodeId: "voice-mode", label: "Voice mode", change: "updated", statusFrom: "on_track", statusTo: "blocked" }],
});

function input(over: Partial<ChatInput> = {}): ChatInput {
  return {
    user,
    message: "What can sales promise?",
    context: { items: [], sources: [source("src-a", "Launch plan"), source("src-b", "Ads dashboard")] },
    currentView: null,
    knownIds,
    ...over,
  };
}

const view = {
  focusNodeIds: ["voice-mode", "made-up"],
  highlightNodeIds: ["sso-login", "sso-login"],
  visibleDomains: [],
  layout: "clusters",
  caption: "Features you can sell today \u2014 shipped or in beta!",
};

describe("sanitizeView", () => {
  it("drops unknown ids, treats empty domains as all, and keeps copy plain", () => {
    expect(sanitizeView(view, knownIds)).toEqual({
      focusNodeIds: ["voice-mode"],
      highlightNodeIds: ["sso-login"],
      visibleDomains: null,
      layout: "clusters",
      caption: "Features you can sell today, shipped or in beta.",
    });
  });

  it("returns null for malformed input", () => {
    expect(sanitizeView({ layout: "spiral" }, knownIds)).toBeNull();
  });
});

describe("LlmChat", () => {
  it("makes one call with no tools, sends sources with handles, and returns cited sources renumbered", async () => {
    const { llm, requests } = fakeLlm([{ content: "Voice mode is safe to mention [S2]. The launch is on November 14 [S1, S2]." }]);
    const res = await new LlmChat(llm, "deepseek/test").reply(input());

    expect(requests).toHaveLength(1);
    expect("tools" in requests[0]).toBe(false);
    expect(requests[0].max_tokens).toBeLessThanOrEqual(300);
    expect(requests[0].temperature).toBe(0);
    expect(res.reply).toBe("Voice mode is safe to mention [1]. The launch is on November 14 [2, 1].");
    expect(res.sources.map((s) => s.id)).toEqual(["src-b", "src-a"]);
    expect(res.dashboard).toBeNull();
    expect(requests[0].messages[1].content).toContain('"handle":"S1"');
    expect(requests[0].messages[1].content).toContain("Account executive");
    expect(requests[0].messages[0].content).toContain("at most 2 short sentences");
    expect(res.actions).toEqual([]);
  });

  it("lights the stars behind the cited sources", async () => {
    const { llm } = fakeLlm([{ content: "It is blocked [S1]." }]);
    const res = await new LlmChat(llm).reply(input());
    expect(res.viewCommand?.focusNodeIds).toEqual(["voice-mode"]);
  });

  it("trims the context to the top items and sources", async () => {
    const many = Array.from({ length: 9 }, (_, i) => source(`src-${i}`, `Doc ${i}`));
    const { llm, requests } = fakeLlm([{ content: "Fine." }]);
    await new LlmChat(llm).reply(input({ context: { items: [], sources: many } }));
    expect(requests[0].messages[1].content).toContain('"handle":"S5"');
    expect(requests[0].messages[1].content).not.toContain('"handle":"S6"');
  });

  it("streams deltas through the streamer when asked", async () => {
    const { llm, requests } = fakeLlm([]);
    const streamer = vi.fn(async (_req, onDelta: (t: string) => void) => {
      onDelta("Nothing is ");
      onDelta("blocked [S1].");
      return "Nothing is blocked [S1].";
    });
    const deltas: string[] = [];
    const res = await new LlmChat(llm, "m", streamer).reply(input(), (t) => deltas.push(t));
    expect(requests).toHaveLength(0);
    expect(deltas.join("")).toBe("Nothing is blocked [S1].");
    expect(res.reply).toBe("Nothing is blocked [1].");
  });

  it("never shows leaked tool markup", async () => {
    const { llm } = fakeLlm([{ content: "Nothing in sales is at risk. <\uff5cDSML\uff5cfunction_calls> <\uff5cDSML\uff5cinvoke name=\"find_nodes\">" }]);
    const res = await new LlmChat(llm).reply(input());
    expect(res.reply).toBe("Nothing in sales is at risk.");
  });

  it("drops citations to unknown handles", async () => {
    const { llm } = fakeLlm([{ content: "Nothing is blocked [S9]." }]);
    expect(await new LlmChat(llm).reply(input())).toEqual({ reply: "Nothing is blocked.", viewCommand: null, dashboard: null, sources: [], actions: [] });
  });

  it("speaks to the person by first name as their chief of staff, framed by their role", async () => {
    const { llm, requests } = fakeLlm([{ content: "Fine." }]);
    await new LlmChat(llm).reply(input({ org: { name: "Acme", description: "", context: "" } as ChatInput["org"] }));
    const system = requests[0].messages[0].content as string;
    expect(system).toContain("You are Sam's personal chief of staff at Acme");
    expect(system).toContain('"Account executive. Deals and renewals."');
    expect(system).toContain("For your sales call");
    expect(system).toContain("ACTIONS:");
  });

  it("puts the last turns in the messages, without the old citation numbers", async () => {
    const { llm, requests } = fakeLlm([{ content: "Ask Devon to cut the latency budget [S1]." }]);
    const history = [
      { role: "user" as const, text: "What is blocking voice mode?" },
      { role: "assistant" as const, text: "The latency fix is blocked [1, 2]." },
    ];
    await new LlmChat(llm).reply(input({ message: "How would you fix this?", history }));
    const msgs = requests[0].messages;
    expect(msgs.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(msgs[1].content).toBe("What is blocking voice mode?");
    expect(msgs[2].content).toBe("The latency fix is blocked.");
    expect(msgs[3].content).toContain("Question: How would you fix this?");
  });

  it("strips the ACTIONS tail from the reply, the stream, and parses it into actions", async () => {
    const { llm } = fakeLlm([]);
    const full = "Voice mode is blocked [S1].\nACTIONS: open:S1 (Read the launch plan) | ask:Who owns the latency fix? (Who owns it) | show:blocked engineering work (Show blockers) | ask:one more?";
    const streamer = vi.fn(async (_req, onDelta: (t: string) => void) => {
      for (const chunk of full.match(/.{1,5}/gs)!) onDelta(chunk);
      return full;
    });
    const deltas: string[] = [];
    const res = await new LlmChat(llm, "m", streamer).reply(input(), (t) => deltas.push(t));
    expect(deltas.join("")).toBe("Voice mode is blocked [S1].");
    expect(res.reply).toBe("Voice mode is blocked [1].");
    expect(res.actions).toEqual([
      { kind: "open", label: "Read the launch plan", value: "src-a", target: "source" },
      { kind: "ask", label: "Who owns it", value: "Who owns the latency fix?" },
      { kind: "show", label: "Show blockers", value: "blocked engineering work" },
    ]);
  });

  it("drops item ids cited as handles and follow-ups that repeat the question", async () => {
    const { llm } = fakeLlm([{ content: "Readiness is 72 percent [general-release] and the post is ready [launch announcement].\nACTIONS: ask:What can sales promise? | ask:Who signs off? (Who signs off)" }]);
    const res = await new LlmChat(llm).reply(input());
    expect(res.reply).toBe("Readiness is 72 percent and the post is ready.");
    expect(res.actions.map((a) => a.value)).toEqual(["Who signs off?"]);
  });

  it("caps citations at 3 sources", async () => {
    const many = Array.from({ length: 5 }, (_, i) => source(`src-${i}`, `Doc ${i}`));
    const { llm } = fakeLlm([{ content: "A [S1]. B [S2, S3]. C [S4, S1]." }]);
    const res = await new LlmChat(llm).reply(input({ context: { items: [], sources: many } }));
    expect(res.sources.map((s) => s.id)).toEqual(["src-0", "src-1", "src-2"]);
    expect(res.reply).toBe("A [1]. B [2, 3]. C [1].");
  });
});

describe("actions", () => {
  const sources = new Map([["S1", source("src-a", "Launch plan")]]);
  const items = [{ id: "voice-mode", label: "Voice mode" }] as ChatInput["context"]["items"];

  it("opens nodes by id, drops unknown targets, and fills short labels", () => {
    expect(parseActions(" open:voice-mode | open:S7 | open:made-up | ask:Is it sellable? | show:sales pipeline", { sources, items, knownIds })).toEqual([
      { kind: "open", label: "Open Voice mode", value: "voice-mode", target: "node" },
      { kind: "ask", label: "Is it sellable", value: "Is it sellable?" },
      { kind: "show", label: "Show sales pipeline", value: "sales pipeline" },
    ]);
  });

  it("holds back a partial ACTIONS marker while streaming", () => {
    expect(visibleEnd("It is blocked.\nACTI")).toBe("It is blocked.".length);
    expect(visibleEnd("It is blocked.\nACTIONS: ask:x")).toBe("It is blocked.".length);
    expect(visibleEnd("All clear.")).toBe("All clear.".length);
  });
});
