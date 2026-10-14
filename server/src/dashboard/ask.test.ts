import { describe, expect, it } from "vitest";
import type { DashboardSpec, User, Widget, WidgetFilter } from "@/contract/types";
import { SEED_USERS } from "@/db/seed";
import { readGraph } from "@/graph/view";
import { memoryStore } from "@/test/helpers";
import { fakeLlm, jsonTurn } from "@/test/llm";
import { askAndSaveDashboard, askDashboard, type AskTrace } from "./ask";
import { draftDashboard, keepsFilters } from "./draft";
import { heuristicDashboard } from "./heuristic";
import { parseAsk } from "./parse";

const store = memoryStore({ seed: true });
const graph = readGraph(store);
const user = (id: string): User => SEED_USERS.find((u) => u.id === id)!;
const mina = user("mina"); // growth marketer
const devon = user("devon"); // engineer
const sam = user("sam"); // account executive
const trace = (): AskTrace => ({ draft: false, modelCalls: 0, promptChars: 0, ms: 0 });

const filters = (d: DashboardSpec | null, kind?: Widget["kind"]) =>
  (d?.widgets ?? []).filter((w) => !kind || w.kind === kind).map((w) => w.filter);
const has = (d: DashboardSpec | null, kind: Widget["kind"], match: Partial<WidgetFilter>) =>
  filters(d, kind).some((f) => f && Object.entries(match).every(([k, v]) => JSON.stringify(f[k as keyof WidgetFilter]) === JSON.stringify(v)));

async function ask(u: User, message: string, turns: Parameters<typeof fakeLlm>[0] = []) {
  const { llm, requests } = fakeLlm(turns);
  const t = trace();
  const current = heuristicDashboard(u, graph);
  const drafts: DashboardSpec[] = [];
  const d = await askDashboard(u, message, current, graph, { llm, onDraft: (s) => drafts.push(s) }, t);
  return { d, requests, t, drafts };
}

describe("parseAsk", () => {
  it("splits a compound ask into one filter group per thing", () => {
    const i = parseAsk("show me every blocked marketing thing and the Google Ads changes from today", mina, graph);
    expect(i.groups).toEqual([
      expect.objectContaining({ statuses: ["blocked"], domains: ["marketing"], source: null, sinceHours: null }),
      expect.objectContaining({ source: "google ads", sinceHours: 24, domains: null, statuses: null }),
    ]);
    expect(i.leftover).toEqual([]);
  });

  it("reads owners by first name, status pairs, recency windows, and quoted queries", () => {
    expect(parseAsk("show what Priya owns", devon, graph).groups).toEqual([expect.objectContaining({ owner: "Priya Shah" })]);
    expect(parseAsk("show blocked and at risk sales", sam, graph).groups).toEqual([
      expect.objectContaining({ statuses: ["blocked", "at_risk"], domains: ["sales"] }),
    ]);
    expect(parseAsk("engineering changes in the last 3 days", devon, graph).groups[0]).toMatchObject({ domains: ["engineering"], sinceHours: 72 });
    expect(parseAsk('show work about "voice"', devon, graph).groups[0]).toMatchObject({ query: "voice" });
    expect(parseAsk("show my work", sam, graph).groups[0]).toMatchObject({ owner: "Sam Ortiz" });
  });

  it("flags only and add, and keeps unknown words as leftovers for the model", () => {
    expect(parseAsk("only sales", sam, graph)).toMatchObject({ only: true, leftover: [] });
    expect(parseAsk("also show the constellation", sam, graph)).toMatchObject({ add: true, kinds: ["constellation"] });
    expect(parseAsk("show the voice launch plan", devon, graph).leftover).toEqual(["voice", "launch", "plan"]);
  });
});

describe("asks from real personas", () => {
  it("marketing: blocked marketing plus today's Google Ads changes, instantly and with no model call", async () => {
    const { d, requests, t, drafts } = await ask(mina, "show me every blocked marketing thing and the Google Ads changes from today");
    expect(requests).toHaveLength(0);
    expect(t).toMatchObject({ draft: true, modelCalls: 0 });
    expect(drafts).toHaveLength(1);
    expect(d?.origin).toBe("chat");
    expect(d?.title).toBe("Blocked marketing work and Google Ads changes today");
    expect(has(d, "node_list", { domains: ["marketing"], statuses: ["blocked"] })).toBe(true);
    expect(has(d, "node_list", { source: "google ads", sinceHours: 24 })).toBe(true);
    expect(has(d, "activity", { source: "google ads", sinceHours: 24 })).toBe(true);
    expect(has(d, "kpi", { domains: ["marketing"], statuses: ["blocked"] })).toBe(true);
  });

  it("engineering: blocked engineering work fills every widget with the filter", async () => {
    const { d, requests } = await ask(devon, "show me blocked engineering work");
    expect(requests).toHaveLength(0);
    const scoped = d!.widgets.filter((w) => w.filter);
    expect(scoped.length).toBeGreaterThanOrEqual(3);
    for (const w of scoped) expect(w.filter).toMatchObject({ domains: ["engineering"], statuses: ["blocked"] });
    // Without "only", one unfiltered live feed stays.
    expect(d!.widgets.filter((w) => !w.filter).map((w) => w.kind)).toEqual(["activity"]);
  });

  it("engineering: an owner ask reaches the widgets as an owner filter", async () => {
    const { d } = await ask(devon, "show what Priya owns");
    expect(has(d, "node_list", { owner: "Priya Shah" })).toBe(true);
    expect(d?.title).toBe("Priya Shah's work");
  });

  it("sales: only sales removes everything unrelated", async () => {
    const { d } = await ask(sam, "only sales");
    expect(d!.widgets.length).toBeGreaterThan(0);
    for (const w of d!.widgets) expect(w.filter?.domains).toEqual(["sales"]);
  });

  it("sales: add keeps the board and puts the new widget first", async () => {
    const current = heuristicDashboard(sam, graph);
    const d = draftDashboard(sam, "also show at risk deals", current, graph);
    expect(d?.widgets[0].filter).toMatchObject({ domains: ["sales"], statuses: ["at_risk"] });
    expect(d?.title).toBe(current.title);
    expect(d?.widgets.some((w) => w.id === "deals")).toBe(true);
  });

  it("a bare filter phrase reshapes too, but a question does not", async () => {
    expect((await ask(mina, "blocked marketing work")).d).not.toBeNull();
    const q = await ask(mina, "What changed in the last hour?");
    expect(q.d).toBeNull();
    expect(q.requests).toHaveLength(0);
  });

  it("refines with one small model call when words are left over, and keeps the parsed filters", async () => {
    const refined = {
      title: "Voice launch, blocked",
      subtitle: "Blocked engineering work on the voice launch.",
      widgets: [
        { id: "l", kind: "node_list", title: "Blocked voice work", size: "full", metric: null, text: null,
          filter: { domains: ["engineering"], statuses: ["blocked"], nodeIds: null, owner: null, query: "voice", sinceHours: null, source: null } },
        { id: "a", kind: "activity", title: "Live", size: "md", metric: null, filter: null, text: null },
      ],
    };
    const { d, requests, t, drafts } = await ask(devon, "show blocked engineering work for the voice launch", [jsonTurn({ change: true, dashboard: refined })]);
    expect(drafts).toHaveLength(1);
    expect(requests).toHaveLength(1);
    expect(t.modelCalls).toBe(1);
    expect(t.promptChars).toBeLessThan(4500);
    const prompt = requests[0].messages.map((m) => String(m.content)).join("\n");
    expect(prompt).toContain("Draft:");
    expect(prompt).not.toContain("Nodes [id");
    expect(d?.title).toBe("Voice launch, blocked");
    expect(d?.widgets[0].filter).toMatchObject({ query: "voice", statuses: ["blocked"] });
  });

  it("drops a refinement that loses a parsed filter and keeps the draft", async () => {
    const lossy = {
      title: "Marketing",
      subtitle: "All marketing.",
      widgets: [{ id: "l", kind: "node_list", title: "Marketing", size: "full", metric: null, text: null,
        filter: { domains: ["marketing"], statuses: null, nodeIds: null, owner: null, query: null, sinceHours: null, source: null } }],
    };
    const { d } = await ask(mina, "show blocked marketing for the spring push", [jsonTurn({ change: true, dashboard: lossy })]);
    expect(has(d, "node_list", { domains: ["marketing"], statuses: ["blocked"] })).toBe(true);
    expect(keepsFilters([{ domains: ["marketing"], statuses: ["blocked"], nodeIds: null, owner: null, query: null }], d!)).toBe(true);
  });

  it("keeps the draft when the model fails or says nothing changed", async () => {
    const failed = await ask(sam, "show at risk sales for the enterprise segment", [{ content: "not json" }, { content: "still not" }]);
    expect(has(failed.d, "node_list", { domains: ["sales"], statuses: ["at_risk"] })).toBe(true);
    const unchanged = await ask(sam, "show at risk sales for the enterprise segment", [jsonTurn({ change: false, dashboard: { title: "x", subtitle: "", widgets: [] } })]);
    expect(unchanged.d?.title).toBe("At risk sales work");
  });

  it("enforces only on the model's answer too", async () => {
    const leaky = {
      title: "Sales",
      subtitle: "",
      widgets: [
        { id: "l", kind: "node_list", title: "Deals", size: "full", metric: null, text: null,
          filter: { domains: ["sales"], statuses: null, nodeIds: null, owner: null, query: "renewal", sinceHours: null, source: null } },
        { id: "m", kind: "map", title: "Map", size: "full", metric: null, filter: null, text: null },
        { id: "a", kind: "activity", title: "Live", size: "md", metric: null, filter: null, text: null },
      ],
    };
    const { d } = await ask(sam, "only sales for the enterprise push", [jsonTurn({ change: true, dashboard: leaky })]);
    expect(d?.widgets.map((w) => w.kind)).toEqual(["node_list", "activity"]);
  });
});

describe("askAndSaveDashboard", () => {
  it("saves the draft at once and the refined spec per person, leaving others alone", async () => {
    const s = memoryStore({ seed: true });
    const { llm } = fakeLlm([]);
    let savedAtDraft: DashboardSpec | null = null;
    const d = await askAndSaveDashboard(s, mina, "only google ads changes from today", { llm, onDraft: () => (savedAtDraft = s.getDashboard("mina")) });
    expect(savedAtDraft).not.toBeNull();
    expect(s.getDashboard("mina")).toEqual(d);
    for (const w of d!.widgets) expect(w.filter).toMatchObject({ source: "google ads", sinceHours: 24 });
    expect(s.getDashboard("sam")).toBeNull();
  });
});
