import { describe, expect, it } from "vitest";
import { fakeLlm, jsonTurn } from "@/test/llm";
import { cardsToUpdate, domainForRole, LlmExtractor } from "./extract";

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
