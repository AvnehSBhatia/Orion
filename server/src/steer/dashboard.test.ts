import { describe, expect, it } from "vitest";
import { dashboardSpec, MAX_WIDGETS } from "@/contract/schemas";
import type { GraphResponse, User } from "@/contract/types";
import { pca, scaleColumns } from "@/graph/projection";
import { fakeLlm, jsonTurn } from "@/test/llm";
import { askDashboard, composeRoleDashboard, heuristicDashboard, looksLikeLayoutRequest, personaOf, sanitizeDashboard, withLiveWidgets } from "./dashboard";

const person = (role: string, name = "Sam Ortiz"): User => ({ id: "sam", name, role, teamDescription: "" });
const graph: GraphResponse = { nodes: [], edges: [], gaps: [] };
const live = (kinds: string[]) => kinds.includes("activity") && (kinds.includes("constellation") || kinds.includes("map"));

describe("heuristicDashboard", () => {
  it("reads the persona from the role, founder first", () => {
    expect(personaOf("Founder. I also run sales calls.")).toBe("founder");
    expect(personaOf("Account executive. Deals and renewals.")).toBe("sales");
    expect(personaOf("Backend engineer on the voice team")).toBe("engineering");
    expect(personaOf("Growth marketing")).toBe("marketing");
    expect(personaOf("ML research scientist")).toBe("research");
    expect(personaOf("Supply chain and vendors")).toBe("ops");
    expect(personaOf("Generalist")).toBe("general");
  });

  it.each(["Founder and CEO", "Account executive", "Frontend engineer", "Brand marketing", "Research scientist", "Operations lead", "Intern"])(
    "builds a valid live dashboard for %s",
    (role) => {
      const d = heuristicDashboard(person(role));
      expect(d.origin).toBe("role");
      expect(d.widgets.length).toBeGreaterThanOrEqual(6);
      expect(d.widgets.length).toBeLessThanOrEqual(MAX_WIDGETS);
      expect(live(d.widgets.map((w) => w.kind))).toBe(true);
      expect(new Set(d.widgets.map((w) => w.id)).size).toBe(d.widgets.length);
      expect(dashboardSpec.parse(d).widgets).toEqual(d.widgets.map((w) => ({ ...w, id: w.id.replace(/_/g, "-") })));
    },
  );

  it("shapes widgets to the role", () => {
    const sales = heuristicDashboard(person("Sales lead"));
    expect(sales.widgets.some((w) => w.kind === "kpi" && w.metric === "sellable")).toBe(true);
    const eng = heuristicDashboard(person("Software engineer"));
    expect(eng.widgets.find((w) => w.kind === "node_list")?.filter).toMatchObject({ domains: ["engineering"], statuses: ["blocked", "at_risk"] });
  });

  it("adds an assigned list only when the person owns work", () => {
    const owned: GraphResponse = { ...graph, nodes: [{ owner: "Sam" } as never] };
    expect(heuristicDashboard(person("Engineer"), owned).widgets.some((w) => w.filter?.owner === "Sam Ortiz")).toBe(true);
    expect(heuristicDashboard(person("Engineer"), graph).widgets.some((w) => w.filter?.owner)).toBe(false);
  });
});

describe("sanitizeDashboard", () => {
  it("coerces missing fields, drops bad widgets and unknown ids, dedupes ids, and caps the count", () => {
    const raw = {
      title: "Deals — this week!",
      widgets: [
        { kind: "kpi", title: "Blocked" },
        { kind: "kpi", id: "kpi", size: "huge", metric: "nope" },
        { kind: "node_list", filter: { domains: ["sales", "space"], nodeIds: ["a", "ghost"], statuses: [] } },
        { kind: "note" },
        { kind: "spiral" },
        "junk",
        ...Array.from({ length: 20 }, () => ({ kind: "activity" })),
      ],
    };
    const d = sanitizeDashboard(raw, { origin: "chat", allowedIds: new Set(["a"]) })!;
    expect(d.title).toBe("Deals, this week.");
    expect(d.subtitle).toBe("");
    expect(d.origin).toBe("chat");
    expect(d.widgets).toHaveLength(MAX_WIDGETS);
    expect(d.widgets[0]).toEqual({ id: "kpi", kind: "kpi", title: "Blocked", size: "md", metric: "total_nodes", filter: null, text: null });
    expect(d.widgets[1]).toMatchObject({ id: "kpi-2", size: "md", metric: "total_nodes" });
    expect(d.widgets[2].filter).toEqual({ domains: ["sales"], statuses: null, nodeIds: ["a"], owner: null, query: null });
    expect(d.widgets.slice(3).every((w) => w.kind === "activity")).toBe(true);
  });

  it("returns null when nothing usable is left", () => {
    expect(sanitizeDashboard({ widgets: [{ kind: "nope" }] }, { origin: "chat" })).toBeNull();
    expect(sanitizeDashboard("junk", { origin: "chat" })).toBeNull();
  });

  it("withLiveWidgets makes room for activity and a constellation", () => {
    const full = sanitizeDashboard({ widgets: Array.from({ length: 12 }, (_, i) => ({ kind: "kpi", id: `k${i}` })) }, { origin: "role" })!;
    const d = withLiveWidgets(full);
    expect(d.widgets).toHaveLength(MAX_WIDGETS);
    expect(live(d.widgets.map((w) => w.kind))).toBe(true);
  });
});

describe("composeRoleDashboard", () => {
  it("uses the model's dashboard and adds the live widgets it forgot", async () => {
    const { llm, requests } = fakeLlm([
      jsonTurn({
        title: "Sales desk",
        subtitle: "What to sell.",
        widgets: [
          { id: "s", kind: "kpi", title: "Sellable", size: "sm", metric: "sellable", filter: null, text: null },
          { id: "d", kind: "node_list", title: "Deals", size: "lg", metric: null, filter: { domains: ["sales"], statuses: null, nodeIds: ["x"], owner: null, query: null }, text: null },
          { id: "g", kind: "gaps", title: "Gaps", size: "md", metric: null, filter: null, text: null },
        ],
      }),
    ]);
    const d = await composeRoleDashboard(person("Account executive"), null, graph, { llm, model: "test" });
    expect(d.title).toBe("Sales desk");
    expect(d.widgets[1].filter?.nodeIds).toBeNull();
    expect(live(d.widgets.map((w) => w.kind))).toBe(true);
    expect(requests[0].messages[1].content).toContain("Account executive");
  });

  it("falls back to the heuristic when the model fails", async () => {
    const llm = { complete: async () => Promise.reject(new Error("no key")) };
    const now = new Date("2026-10-10T00:00:00.000Z");
    expect(await composeRoleDashboard(person("Founder"), null, graph, { llm, now })).toEqual(heuristicDashboard(person("Founder"), graph, now));
  });
});

describe("pca", () => {
  it("finds the main axes of spread and scales them into [-1, 1]", () => {
    // Points along (1, 1, 0, 0) with a little spread along (0, 0, 1, 0).
    const rows = Array.from({ length: 50 }, (_, i) => {
      const t = i - 25;
      const e = (i % 5) - 2;
      return [t, t, e * 0.1, 0];
    });
    const xyz = scaleColumns(pca(rows));
    expect(xyz).toHaveLength(50);
    for (const p of xyz) for (const v of p) expect(Math.abs(v)).toBeLessThanOrEqual(1);
    // First axis tracks t, second tracks e.
    const corr = (a: number[], b: number[]) => {
      const m = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
      const [ma, mb] = [m(a), m(b)];
      const cov = a.reduce((s, x, i) => s + (x - ma) * (b[i] - mb), 0);
      return cov / Math.sqrt(a.reduce((s, x) => s + (x - ma) ** 2, 0) * b.reduce((s, x) => s + (x - mb) ** 2, 0));
    };
    expect(Math.abs(corr(xyz.map((p) => p[0]), rows.map((r) => r[0])))).toBeGreaterThan(0.99);
    expect(Math.abs(corr(xyz.map((p) => p[1]), rows.map((r) => r[2])))).toBeGreaterThan(0.99);
    expect(xyz.every((p) => Number.isFinite(p[2]))).toBe(true);
  });

  it("is deterministic and handles tiny inputs", () => {
    const rows = [[1, 2, 3], [2, 1, 0], [0, 0, 1], [3, 3, 3]];
    expect(pca(rows)).toEqual(pca(rows));
    expect(pca([])).toEqual([]);
    expect(scaleColumns(pca([[1, 2]]))).toEqual([[0, 0, 0]]);
  });
});

describe("askDashboard", () => {
  const asker: User = { id: "avneh", name: "Avneh Bhatia", role: "Founder.", teamDescription: "" };
  const graph = { nodes: [{ id: "voice-mode", label: "Voice mode", domain: "engineering", status: "blocked", owner: null, sellable: false }] } as unknown as Pick<GraphResponse, "nodes">;
  const current = heuristicDashboard(asker);
  const spec = {
    title: "Research",
    subtitle: "Models and papers.",
    widgets: [
      { id: "v", kind: "node_list", title: "Voice", size: "lg", metric: null, filter: { domains: null, statuses: null, nodeIds: ["voice-mode", "made-up"], owner: null, query: null }, text: null },
      { id: "a", kind: "activity", title: "Live", size: "sm", metric: null, filter: null, text: null },
    ],
  };

  it("skips the model for plain questions", async () => {
    const { llm, requests } = fakeLlm([]);
    expect(looksLikeLayoutRequest("What changed in the last hour?")).toBe(false);
    expect(await askDashboard(asker, "What changed in the last hour?", current, graph, { llm })).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it("treats role statements and show requests as layout requests", () => {
    expect(looksLikeLayoutRequest("I am a deep ML researcher")).toBe(true);
    expect(looksLikeLayoutRequest("show only sales")).toBe(true);
  });

  it("makes one structured call and keeps only known node ids", async () => {
    const { llm, requests } = fakeLlm([jsonTurn({ change: true, dashboard: spec })]);
    const d = await askDashboard(asker, "I am a deep ML researcher", current, graph, { llm });
    expect(requests).toHaveLength(1);
    expect(requests[0].tools).toBeUndefined();
    expect(requests[0].max_tokens).toBe(2000);
    expect(d?.origin).toBe("chat");
    expect(d?.widgets[0].filter?.nodeIds).toEqual(["voice-mode"]);
  });

  it("returns null when the model says nothing changed", async () => {
    const { llm } = fakeLlm([jsonTurn({ change: false, dashboard: spec })]);
    // The parser reads nothing here, so there is no draft to fall back on.
    expect(await askDashboard(asker, "show me the voice launch plan", current, graph, { llm })).toBeNull();
  });
});
