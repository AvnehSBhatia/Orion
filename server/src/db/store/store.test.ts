import { describe, expect, it } from "vitest";
import { readGraph } from "@/graph/view";
import { extracted, memoryStore } from "@/test/helpers";
import { nodeKey, toPublicNode } from ".";

const prov = { sourceKind: "extension" as const, sourceRef: "https://example.com/a" };

describe("upsertGraph", () => {
  it("dedupes by type and normalized label, newer non-null fields win", () => {
    const store = memoryStore();
    store.upsertGraph({ nodes: [extracted({ label: "Q4 Search Campaign", type: "campaign", owner: "Mina Rao" })], edges: [] }, prov);
    const { touched } = store.upsertGraph(
      {
        nodes: [extracted({ label: "q4 search-campaign", type: "campaign", owner: null, status: "unknown", todo: "Raise budget" })],
        edges: [],
      },
      { ...prov, sourceRef: "https://example.com/b" },
    );

    const nodes = store.listNodes();
    expect(nodes).toHaveLength(1);
    expect(touched).toEqual([nodes[0].id]);
    expect(nodes[0]).toMatchObject({
      id: "q4-search-campaign",
      owner: "Mina Rao",
      status: "on_track",
      todo: "Raise budget",
      sourceRef: "https://example.com/b",
    });
  });

  it("keeps same label with different types apart", () => {
    const store = memoryStore();
    store.upsertGraph(
      { nodes: [extracted({ label: "Voice mode" }), extracted({ label: "Voice mode", type: "milestone" })], edges: [] },
      prov,
    );
    expect(store.listNodes().map((n) => n.id).sort()).toEqual(["voice-mode", "voice-mode-milestone"]);
    expect(store.findNodeByKey(nodeKey("milestone", "voice mode"))?.id).toBe("voice-mode-milestone");
  });

  it("clears the embedding only when label or summary change", () => {
    const store = memoryStore();
    store.upsertGraph({ nodes: [extracted({ label: "SSO login" })], edges: [] }, prov);
    store.setNodeEmbedding("sso-login", new Float32Array([1, 0]), "m");

    store.upsertGraph({ nodes: [extracted({ label: "SSO login", owner: "Devon Park" })], edges: [] }, prov);
    expect(store.getNode("sso-login")?.embedding).not.toBeNull();

    store.upsertGraph({ nodes: [extracted({ label: "SSO login", summary: "Now with Okta" })], edges: [] }, prov);
    expect(store.getNode("sso-login")?.embedding).toBeNull();
  });

  it("only sets sellable when the update decides it", () => {
    const store = memoryStore();
    store.upsertGraph({ nodes: [extracted({ label: "Voice mode", sellable: true })], edges: [] }, prov);
    store.upsertGraph({ nodes: [extracted({ label: "Voice mode", sellable: null })], edges: [] }, prov);
    expect(store.getNode("voice-mode")?.sellable).toBe(true);
  });

  it("clamps labels and summaries to the contract limits", () => {
    const store = memoryStore();
    const long = "A very long feature name that keeps going past forty characters";
    store.upsertGraph({ nodes: [extracted({ label: long, summary: "word ".repeat(60) })], edges: [] }, prov);
    const [node] = store.listNodes();
    expect(node.label.length).toBeLessThanOrEqual(40);
    expect(node.summary.length).toBeLessThanOrEqual(140);
  });

  it("writes edges only when both endpoints exist, by label or id", () => {
    const store = memoryStore();
    store.upsertGraph({ nodes: [extracted({ label: "Audio streaming service" })], edges: [] }, prov);
    const { edgesAdded } = store.upsertGraph(
      {
        nodes: [extracted({ label: "Voice latency fix", type: "task" })],
        edges: [
          { source: "Audio streaming service", target: "Voice latency fix", relation: "blocks" },
          { source: "voice-latency-fix", target: "Nonexistent thing", relation: "feeds" },
          { source: "Audio streaming service", target: "Voice latency fix", relation: "blocks" },
        ],
      },
      prov,
    );
    expect(edgesAdded).toEqual(["audio-streaming-service__blocks__voice-latency-fix"]);
    expect(store.listEdges()).toHaveLength(1);
  });
});

describe("reads", () => {
  it("never exposes embeddings", () => {
    const store = memoryStore({ seed: true });
    store.listNodes().forEach((n) => store.setNodeEmbedding(n.id, new Float32Array([1]), "m"));
    expect(readGraph(store).nodes.every((n) => !("embedding" in n) && !("key" in n))).toBe(true);
    expect("embedding" in toPublicNode(store.listNodes()[0])).toBe(false);
  });

  it("drops junk to-dos and links stored before the filter", () => {
    const store = memoryStore();
    store.upsertGraph({ nodes: [extracted({ label: "Q4 search campaign", owner: "Mina Rao" })], edges: [] }, prov);
    // Written straight to the row, as older extractions were.
    store.db.prepare("UPDATE nodes SET todo = ?, read_links = ? WHERE id = ?").run(
      "Update 230.",
      JSON.stringify([
        { title: "DuckDuckGo – Protection. Privacy. Peace of mind.", url: "https://duckduckgo.com/" },
        { title: "Campaign", url: "https://ads.google.com/aw/campaigns" },
      ]),
      "q4-search-campaign",
    );
    const node = readGraph(store).nodes.find((n) => n.id === "q4-search-campaign")!;
    expect(node.todo).toBeNull();
    expect(node.readLinks).toEqual([{ title: "Campaign", url: "https://ads.google.com/aw/campaigns" }]);
  });
});
