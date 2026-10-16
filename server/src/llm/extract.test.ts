import { describe, expect, it } from "vitest";
import { fakeLlm, jsonTurn } from "@/test/llm";
import { cardsToUpdate, domainForRole, LlmExtractor, relevantKnown, RELEVANT_KNOWN, type KnownNode } from "./extract";

type Schema = { type?: string; properties?: Record<string, Schema>; items?: Schema; anyOf?: Schema[]; required?: string[]; additionalProperties?: boolean };

/** Strict structured outputs need additionalProperties: false on every object and every property required. */
function assertStrict(schema: Schema, path = "$"): void {
  if (schema.type === "object") {
    expect(schema.additionalProperties, path).toBe(false);
    expect([...(schema.required ?? [])].sort(), path).toEqual(Object.keys(schema.properties ?? {}).sort());
  }
  Object.entries(schema.properties ?? {}).forEach(([k, s]) => assertStrict(s, `${path}.${k}`));
  if (schema.items) assertStrict(schema.items, `${path}[]`);
  schema.anyOf?.forEach((s, i) => assertStrict(s, `${path}|${i}`));
}

const card = (over: Record<string, unknown>) => ({
  label: "Usage export API",
  type: "feature",
  summary: "Admins can download usage as CSV.",
  todo: null,
  readLinks: [],
  owner: null,
  status: "on_track",
  release: "shipped",
  sellable: true,
  ...over,
});

describe("LlmExtractor", () => {
  it("asks for a strict JSON schema and sends page text with the known labels", async () => {
    const { llm, requests } = fakeLlm([jsonTurn({ nodes: [], edges: [] })]);
    await new LlmExtractor(llm, "deepseek/test").fromCapture(
      { url: "https://ads.google.com", title: "Ads", text: "Daily budget 650" },
      [{ id: "voice-mode", label: "Voice mode", type: "feature", domain: "engineering" }],
    );
    const req = requests[0];
    expect(req.model).toBe("deepseek/test");
    expect(req.response_format?.json_schema.name).toBe("build_update");
    expect(req.response_format?.json_schema.strict).toBe(true);
    assertStrict(req.response_format!.json_schema.schema);
    expect(req.messages[1].content).toContain("[feature, engineering] Voice mode");
    expect(req.messages[1].content).toContain("Daily budget 650");
  });

  it("puts what changed ahead of the page and tells the model to record the change", async () => {
    const { llm, requests } = fakeLlm([jsonTurn({ nodes: [], edges: [] }), jsonTurn({ nodes: [], edges: [] })]);
    const ex = new LlmExtractor(llm, "deepseek/test");
    const diff = 'Changed: "Daily budget $900" -> "Daily budget $1,200" ($900 -> $1,200)';
    await ex.fromCapture(
      { url: "https://ads.google.com", title: "Ads", text: "Daily budget $1,200", changes: { since: "2026-10-10T12:00:00.000Z", diff } },
      [{ id: "q4", label: "Q4 search campaign", type: "campaign", domain: "marketing" }],
      { org: null, author: { name: "Mina Rao", role: "Growth marketer" } },
    );
    const [system, user] = requests[0].messages.map((m) => m.content as string);
    expect(system).toContain("That change is the news: record it.");
    expect(user).toContain(`What changed since the last capture (at 2026-10-10T12:00:00.000Z):\n${diff}\n\nPage text now (for context, may be shortened):\nDaily budget $1,200`);
    expect(user.indexOf("What changed")).toBeLessThan(user.indexOf("Page text now"));
    expect(user).toContain("Sent by: Mina Rao");

    await ex.fromCapture({ url: "https://ads.google.com", title: "Ads", text: "Daily budget $900" }, []);
    const [system2, user2] = requests[1].messages.map((m) => m.content as string);
    expect(system2).not.toContain("That change is the news");
    expect(user2).not.toContain("What changed");
    expect(user2).toContain("Page text:\nDaily budget $900");
  });

  it("captures never decide sellable and are capped at 8 nodes", async () => {
    const node = { label: "x", type: "campaign", domain: "marketing", summary: "s", todo: null, readLinks: [], owner: null, status: "on_track" };
    const { llm } = fakeLlm([jsonTurn({ nodes: Array.from({ length: 12 }, (_, i) => ({ ...node, label: `n${i}` })), edges: [] })]);
    const out = await new LlmExtractor(llm).fromCapture({ url: "u", title: "t", text: "h" }, []);
    expect(out.nodes).toHaveLength(8);
    expect(out.nodes.every((n) => n.sellable === null)).toBe(true);
  });

  it("drops junk to-dos and links the model writes", async () => {
    const node = { label: "Q4 search campaign", type: "campaign", domain: "marketing", summary: "s", owner: null, status: "on_track" };
    const links = [
      { title: "DuckDuckGo – Protection. Privacy. Peace of mind.", url: "https://duckduckgo.com/" },
      { title: "q4 budget - Google Search", url: "https://www.google.com/search?q=q4+budget" },
      { title: "New Tab", url: "chrome://newtab/" },
      { title: "Budget doc", url: "notes" },
      { title: "Campaign", url: "https://ads.google.com/aw/campaigns" },
      { title: "Campaign again", url: "https://ads.google.com/aw/campaigns/#top" },
    ];
    const { llm } = fakeLlm([
      jsonTurn({
        nodes: [
          { ...node, todo: "Update 230.", readLinks: links },
          { ...node, label: "Acme renewal", todo: "Send the renewal quote to Acme by Friday.", readLinks: [] },
        ],
        edges: [],
      }),
    ]);
    const out = await new LlmExtractor(llm).fromCapture({ url: "u", title: "t", text: "h" }, []);
    expect(out.nodes[0]).toMatchObject({ todo: null, readLinks: [{ title: "Campaign", url: "https://ads.google.com/aw/campaigns" }] });
    expect(out.nodes[1].todo).toBe("Send the renewal quote to Acme by Friday.");
  });

  it("drops junk to-dos from code cards", async () => {
    const { llm } = fakeLlm([jsonTurn({ nodes: [card({ todo: "Update 257." })], edges: [] })]);
    const out = await new LlmExtractor(llm).fromCode({ repo: "r", commitSha: "s", files: [{ path: "a.ts", diff: "+x" }] }, []);
    expect(out.nodes[0].todo).toBeNull();
  });

  it("maps code cards to engineering and keeps in-progress work unsellable", async () => {
    const { llm, requests } = fakeLlm([
      jsonTurn({ nodes: [card({}), card({ label: "Voice mode v2", release: "in_progress", sellable: true, status: "unknown" })], edges: [] }),
    ]);
    const out = await new LlmExtractor(llm).fromCode({ repo: "r", commitSha: "s", files: [{ path: "a.ts", diff: "+x" }] }, []);
    expect(requests[0].response_format?.json_schema.name).toBe("feature_cards");
    assertStrict(requests[0].response_format!.json_schema.schema);
    expect(out.nodes.map((n) => [n.domain, n.sellable])).toEqual([
      ["engineering", true],
      ["engineering", false],
    ]);
  });

  it("retries once on non-JSON, then rejects output that does not match the contract", async () => {
    const { llm, requests } = fakeLlm([{ content: "sorry" }, jsonTurn({ nodes: [card({ type: "spaceship" })], edges: [] })]);
    await expect(
      new LlmExtractor(llm).fromCode({ repo: "r", commitSha: "s", files: [{ path: "a.ts", diff: "" }] }, []),
    ).rejects.toMatchObject({ status: 422 });
    expect(requests).toHaveLength(2);
  });
});

describe("domainForRole", () => {
  it("reads the domain from the job title first", () => {
    expect(domainForRole("Software engineer. I ship API changes.")).toBe("engineering");
    expect(domainForRole("Account executive. I run renewals and deal size.")).toBe("sales");
    expect(domainForRole("Growth marketer. I own Google Ads spend.")).toBe("marketing");
    expect(domainForRole("Finance. I track whether the launch week is ahead of plan.")).toBe("ops");
    expect(domainForRole("Operations. Support and engineering look at the same incident.")).toBe("ops");
    expect(domainForRole("Sales engineer. I demo the product.")).toBe("sales");
    expect(domainForRole("")).toBeNull();
    expect(domainForRole("I do things.")).toBeNull();
  });

  it("puts author cards in the author's domain", () => {
    const cards = [{ label: "Launch post", summary: "s", status: "in_beta" as const, paths: ["a.md"] }];
    expect(cardsToUpdate(cards, "marketing").nodes[0].domain).toBe("marketing");
    expect(cardsToUpdate(cards).nodes[0].domain).toBe("engineering");
  });
});

describe("known items in the prompt", () => {
  const kn = (label: string, updatedAt = "2026-10-01T00:00:00.000Z"): KnownNode => ({ id: label, label, type: "task", domain: "engineering", updatedAt });
  const many = Array.from({ length: 100 }, (_, i) => kn(`Filler item ${i}`, `2026-09-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`));

  it("sends the items a page names first, then the newest, and no more than the cap", () => {
    const named = [kn("NW-482 Escalation routing"), kn("Acme renewal")];
    const out = relevantKnown([...many, ...named], "NW-482 drops tickets in escalation routing. Blocks the Acme renewal.");
    expect(out).toHaveLength(RELEVANT_KNOWN);
    expect(out.slice(0, 2).map((n) => n.label).sort()).toEqual(["Acme renewal", "NW-482 Escalation routing"]);
    expect(out[2].updatedAt).toBe("2026-09-28T00:00:00.000Z");
  });

  it("sends a short list whole", () => {
    expect(relevantKnown(many.slice(0, 5), "anything")).toHaveLength(5);
  });
});

describe("Mac blocks in one call", () => {
  const block = (title: string) => ({ url: "mac://Linear", title, text: `${title}. Status: blocked.` });
  const node = (label: string) => ({ label, type: "task", domain: "engineering", summary: "Blocked.", owner: null, status: "blocked" });

  it("sends the blocks the gate lets through in one request and gives each block its own update", async () => {
    const { llm, requests } = fakeLlm([jsonTurn({ blocks: [{ block: 2, nodes: [node("Routing fix")], edges: [] }, { block: 1, nodes: [node("Pricing page")], edges: [] }] })]);
    const ex = new LlmExtractor(llm, "test/model", async (input) => input.title !== "Lunch menu");
    const out = await ex.fromCaptures([block("Pricing page"), block("Lunch menu"), block("Routing fix")], []);
    expect(requests).toHaveLength(1);
    expect(requests[0].messages.at(-1)!.content).toContain("Block 2\nURL: mac://Linear\nTitle: Routing fix");
    expect(requests[0].messages.at(-1)!.content).not.toContain("Lunch menu");
    assertStrict((requests[0].response_format as { json_schema: { schema: Schema } }).json_schema.schema);
    expect(out.map((u) => u.nodes.map((n) => n.label))).toEqual([["Pricing page"], [], ["Routing fix"]]);
    expect(out[0].nodes[0]).toMatchObject({ todo: null, readLinks: [], sellable: null });
  });

  it("makes no call when the gate turns every block away", async () => {
    const { llm, requests } = fakeLlm([]);
    const out = await new LlmExtractor(llm, "test/model", async () => false).fromCaptures([block("a"), block("b")], []);
    expect(requests).toHaveLength(0);
    expect(out).toEqual([{ nodes: [], edges: [] }, { nodes: [], edges: [] }]);
  });
});
