import { describe, expect, it } from "vitest";
import type { PublicNode, Source } from "@/contract/types";
import type { ChoiceAnswer, Decide, DecideRequest } from "@/llm/decisions";
import { jevAnswer, routeMessage } from "./router";

const user = { name: "Sam Ortiz", role: "Account executive. Deals and renewals." };

const node = (id: string, label: string, over: Partial<PublicNode> = {}) =>
  ({
    id,
    label,
    domain: "engineering",
    status: "on_track",
    owner: null,
    summary: `${label} is moving. More detail here.`,
    updatedAt: "2026-10-10T10:00:00.000Z",
    ...over,
  }) as PublicNode;

const nodes = [
  node("launch", "Launch checklist", { status: "blocked", owner: "Devon Park", summary: "Waiting on legal review of the privacy policy. Second sentence." }),
  node("pricing", "Pricing page", { status: "at_risk", updatedAt: "2026-10-12T10:00:00.000Z" }),
  node("voice", "Voice mode"),
];

const choice = (probabilities: Record<string, number>): ChoiceAnswer => ({
  choice: Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0][0],
  probabilities,
});

/** Answers Drex's route question and Jev's task and item questions from scripted probabilities; records requests. */
function fakeDecide({ jev = 0.6, task = { answer: 0.9, dashboard: 0.05, llm: 0.05 }, item = { i0: 0.9, none: 0.1 } as Record<string, number> } = {}) {
  const requests: DecideRequest[] = [];
  const decide: Decide = async (req): Promise<Record<string, ChoiceAnswer>> => {
    requests.push(req);
    if (req.questions.route) return { route: choice({ jev, llm: 1 - jev }) };
    return { task: choice(task), item: choice(item) };
  };
  return { decide, requests };
}

describe("routeMessage", () => {
  it("sends writing to the chat model on Drex's word alone, without asking Jev", async () => {
    const { decide, requests } = fakeDecide({ jev: 0.01 });
    expect(await routeMessage(decide, { user, message: "write an email about launch risks", nodes })).toEqual({ to: "llm", why: "router" });
    expect(requests.map((r) => r.model)).toEqual(["nace-ai/drex-v2.0"]);
  });

  it("hands a lookup to Jev with every item card as an option, and answers with the items it picks", async () => {
    const { decide, requests } = fakeDecide({ item: { i0: 0.6, i1: 0.3, i2: 0.05, none: 0.05 } });
    const routed = await routeMessage(decide, { user, message: "what is blocked on the launch?", prev: "how is launch going?", nodes });
    expect(requests[1].model).toBe("~typesafe/jev-latest");
    expect(Object.keys(requests[1].questions.item.criteria)).toEqual(["none", "i0", "i1", "i2"]);
    expect(requests[1].questions.item.criteria.i0).toContain("Launch checklist (engineering, blocked, Devon Park");
    expect(requests[1].state).toMatchObject({ message: "what is blocked on the launch?", earlierQuestion: "how is launch going?" });
    // Newest first, and the 5% item is left out.
    expect(routed).toEqual({ to: "jev", task: "answer", items: [nodes[1], nodes[0]] });
  });

  it("caps the options at 255", async () => {
    const { decide, requests } = fakeDecide();
    const many = Array.from({ length: 400 }, (_, i) => node(`n${i}`, `Item ${i}`));
    await routeMessage(decide, { user, message: "status of item 3", nodes: many });
    expect(Object.keys(requests[1].questions.item.criteria)).toHaveLength(255);
  });

  it("routes a dashboard change to Jev", async () => {
    const { decide } = fakeDecide({ task: { answer: 0.1, dashboard: 0.85, llm: 0.05 } });
    expect(await routeMessage(decide, { user, message: "focus my board on sales", nodes })).toEqual({ to: "jev", task: "dashboard" });
  });

  it("falls back to the chat model when Jev wants it or no item is a clear match", async () => {
    const wantsLlm = fakeDecide({ task: { answer: 0.2, dashboard: 0.1, llm: 0.7 } });
    expect(await routeMessage(wantsLlm.decide, { user, message: "summarize the quarter", nodes })).toEqual({ to: "llm", why: "jev" });
    const vague = fakeDecide({ item: { i0: 0.25, i1: 0.25, i2: 0.25, none: 0.25 } });
    expect(await routeMessage(vague.decide, { user, message: "what changed?", nodes })).toEqual({ to: "llm", why: "no item" });
    const none = fakeDecide({ item: { i0: 0.05, none: 0.95 } });
    expect(await routeMessage(none.decide, { user, message: "status of the moon base", nodes })).toEqual({ to: "llm", why: "no item" });
  });
});

describe("jevAnswer", () => {
  const source = (id: string, nodeId: string): Source => ({
    id,
    kind: "extension",
    ref: `https://example.com/${id}`,
    title: id,
    excerpt: "",
    authorId: "devon",
    authorName: "Devon Park",
    createdAt: "2026-10-10T10:00:00.000Z",
    hasImage: false,
    changes: [{ nodeId, label: nodeId, change: "updated", statusFrom: null, statusTo: "blocked" }],
  });

  it("writes one sentence per item from its card, citing the newest document that changed it", () => {
    const res = jevAnswer([nodes[0], nodes[2]], [source("new", "launch"), source("old", "launch")]);
    expect(res.reply).toBe("Launch checklist is blocked, with Devon Park: Waiting on legal review of the privacy policy. [1] Voice mode is on track: Voice mode is moving.");
    expect(res.sources.map((s) => s.id)).toEqual(["new"]);
    expect(res.viewCommand?.focusNodeIds).toEqual(["launch", "voice"]);
    expect(res.actions).toEqual([
      { kind: "open", label: "Open Launch checklist", value: "launch", target: "node" },
      { kind: "open", label: "Open Voice mode", value: "voice", target: "node" },
    ]);
  });
});
