import { describe, expect, it } from "vitest";
import type { Edge, PublicNode, Relation } from "@/contract/types";
import { readGraph } from "@/graph/view";
import { memoryStore } from "@/test/helpers";
import { applyGapTodos, findGaps } from "./gaps";
import { applyRipple, ripple } from "./ripple";

const node = (id: string, over: Partial<PublicNode> = {}): PublicNode => ({
  id,
  label: id,
  type: "feature",
  domain: "engineering",
  summary: "",
  todo: null,
  readLinks: [],
  owner: "Someone",
  status: "on_track",
  sellable: false,
  sourceKind: "manual",
  sourceRef: "test",
  updatedAt: "2026-10-10T00:00:00.000Z",
  ...over,
});
const edge = (source: string, relation: Relation, target: string): Edge => ({
  id: `${source}__${relation}__${target}`,
  source,
  target,
  relation,
  sourceRef: "test",
});

describe("findGaps", () => {
  it("flags open work with no owner, but not people, suppliers, or done work", () => {
    const gaps = findGaps(
      [
        node("a", { owner: null }),
        node("b", { owner: null, status: "done" }),
        node("c", { owner: null, type: "stakeholder" }),
        node("d", { owner: null, type: "supplier" }),
        node("e"),
      ],
      [],
    );
    expect(gaps).toEqual([{ nodeId: "a", kind: "no_owner", message: "a has no owner." }]);
  });

  it("flags deals with fewer than two stakeholders, linked in either direction", () => {
    const nodes = [
      node("lonely", { type: "deal" }),
      node("single", { type: "deal" }),
      node("healthy", { type: "deal" }),
      node("s1", { type: "stakeholder" }),
      node("s2", { type: "stakeholder" }),
      node("s3", { type: "stakeholder" }),
    ];
    const edges = [edge("s1", "part_of", "single"), edge("s2", "part_of", "healthy"), edge("healthy", "influences", "s3")];
    const kinds = findGaps(nodes, edges).map((g) => [g.nodeId, g.kind, g.message]);
    expect(kinds).toEqual([
      ["lonely", "single_threaded_deal", "lonely has no stakeholder. Add a second contact."],
      ["single", "single_threaded_deal", "single has only one stakeholder. Add a second contact."],
    ]);
  });

  it("fills empty todos from gaps and keeps existing ones", () => {
    const nodes = [node("a", { owner: null }), node("b", { owner: null, todo: "Already planned" })];
    const out = applyGapTodos(nodes, findGaps(nodes, []));
    expect(out.map((n) => n.todo)).toEqual(["Pick an owner for this.", "Already planned"]);
  });
});

describe("ripple", () => {
  it("pushes at_risk downstream through blocks and feeds, transitively", () => {
    const nodes = [node("a", { status: "blocked" }), node("b"), node("c", { status: "unknown" }), node("d")];
    const changes = ripple(nodes, [edge("a", "blocks", "b"), edge("b", "feeds", "c"), edge("c", "influences", "d")]);
    expect(changes).toEqual([
      { nodeId: "b", from: "on_track", to: "at_risk", causeId: "a" },
      { nodeId: "c", from: "unknown", to: "at_risk", causeId: "b" },
    ]);
    expect(applyRipple(nodes, changes).map((n) => n.status)).toEqual(["blocked", "at_risk", "at_risk", "on_track"]);
  });

  it("leaves done and blocked nodes alone and survives cycles", () => {
    const nodes = [node("a", { status: "at_risk" }), node("b", { status: "done" }), node("c", { status: "blocked" }), node("d")];
    const changes = ripple(nodes, [edge("a", "feeds", "b"), edge("a", "blocks", "c"), edge("a", "feeds", "d"), edge("d", "feeds", "a")]);
    expect(changes.map((c) => c.nodeId)).toEqual(["d"]);
  });

  it("is upstream to downstream only", () => {
    expect(ripple([node("a"), node("b", { status: "blocked" })], [edge("a", "blocks", "b")])).toEqual([]);
  });
});

describe("seed graph", () => {
  it("shows the blocked latency fix putting the release at risk", () => {
    const { nodes, gaps } = readGraph(memoryStore({ seed: true }));
    expect(nodes.find((n) => n.id === "voice-mode-general-release")?.status).toBe("at_risk");
    expect(gaps.map((g) => `${g.nodeId}:${g.kind}`).sort()).toEqual([
      "acme-renewal:single_threaded_deal",
      "audio-streaming-service:no_owner",
      "inference-cost-overrun:no_owner",
    ]);
  });
});
