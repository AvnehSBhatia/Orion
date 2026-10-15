import { applyFilter, hasFilter } from "@/components/dashboard/filters";
import type { ActivityResponse, DashboardSpec, Domain, EmbeddingsResponse, GraphResponse, PublicNode, Source, SourceChange, Status, Widget, WidgetKind, WidgetMetric } from "@/lib/api/types";
// The card bank: ~50 candidate cards derived from live data, scored against what the user last asked for.
// Pure functions only, so the dashboard can memoize on (graph, activity, sky, spec) and never fetch per card.


export type CardSize = Widget["size"];

type Base = {
  id: string;
  size: CardSize;
  score: number;
  /** Change signature: a new id or a new sig on a live kind counts as fresh data. */
  sig: string;
  /** Expensive to mount (canvas, map): never rotated in or out on the timer. */
  heavy?: boolean;
  pinned?: boolean;
};

export type Card = Base &
  (
    | { kind: "widget"; widget: Widget }
    | { kind: "node"; node: PublicNode }
    | { kind: "person"; name: string; count: number; lastAt: string; latest: Source | null }
    | { kind: "cluster"; label: string; count: number; top: PublicNode[] }
    | { kind: "change"; source: Source; change: SourceChange }
  );

export type Bank = { pinned: Card[]; ranked: Card[] };

export const DECK_SIZE = 10;
const BANK_SIZE = 50;
/** Kinds whose new or changed data may push into the deck between rotations. */
export const LIVE_KINDS = new Set<Card["kind"]>(["node", "change", "person"]);

// ---- Terms ---------------------------------------------------------------------------

const STOP = new Set(
  "a an and are as at be by for from i im in is it me my of on or our the this that to view dashboard with what who your all show watch need orion want see give let new".split(" "),
);

// A few hand-tuned expansions so a role word pulls in the vocabulary that work actually uses.
const SYN: Record<string, string[]> = {
  research: ["research", "benchmark", "paper", "eval", "model", "experiment", "dataset", "arxiv", "ml", "training"],
  researcher: ["research", "benchmark", "paper", "eval", "model", "experiment", "dataset", "ml"],
  ml: ["model", "training", "eval", "benchmark", "inference", "dataset", "gpu", "research", "paper"],
  ai: ["model", "llm", "eval", "inference", "agent", "research"],
  sale: ["sales", "deal", "customer", "pipeline", "sellable", "prospect", "account", "pricing", "demo"],
  sales: ["sales", "deal", "customer", "pipeline", "sellable", "prospect", "account", "pricing", "demo"],
  call: ["customer", "sellable", "deal", "demo", "pricing"],
  customer: ["customer", "account", "deal", "sellable"],
  engineer: ["engineering", "code", "commit", "deploy", "bug", "api", "infra"],
  engineering: ["engineering", "code", "commit", "deploy", "bug", "api", "infra"],
  marketing: ["marketing", "launch", "campaign", "content", "brand"],
  launch: ["launch", "release", "marketing", "sellable"],
  ops: ["ops", "hiring", "finance", "legal", "process", "vendor"],
  risk: ["blocked", "risk", "gap", "blocker"],
  blocked: ["blocked", "risk", "gap", "blocker"],
  blocker: ["blocked", "risk", "gap"],
  exec: ["blocked", "risk", "gap", "sellable", "total"],
  leadership: ["blocked", "risk", "gap", "sellable", "total"],
  team: ["people", "active", "person"],
  people: ["people", "active", "person"],
  live: ["activity", "capture", "recent"],
  activity: ["activity", "capture", "recent"],
};

const stem = (w: string) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

export function tokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || STOP.has(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

/** What the current spec is about: its words, filters, and their expansions. */
export function specTerms(spec: DashboardSpec): Set<string> {
  const parts = [spec.title, spec.subtitle];
  for (const w of spec.widgets) {
    parts.push(w.title);
    if (w.filter?.query) parts.push(w.filter.query);
    if (w.filter?.owner) parts.push(w.filter.owner);
    if (w.filter?.domains) parts.push(w.filter.domains.join(" "));
    if (w.filter?.statuses) parts.push(w.filter.statuses.join(" "));
    if (w.filter?.source) parts.push(w.filter.source);
  }
  const set = new Set<string>();
  for (const t of tokens(parts.join(" "))) {
    set.add(t);
    for (const s of SYN[t] ?? []) set.add(stem(s));
  }
  return set;
}

function overlap(terms: Set<string>, text: string) {
  if (terms.size === 0) return 0;
  let n = 0;
  const seen = new Set<string>();
  for (const t of tokens(text)) {
    if (terms.has(t) && !seen.has(t)) {
      seen.add(t);
      n++;
    }
  }
  return Math.min(n, 4);
}

// ---- Scoring helpers -----------------------------------------------------------------

const SEVERITY: Record<Status, number> = { blocked: 8, at_risk: 6, on_track: 1, unknown: 0, done: -2 };

function recency(iso: string, now: number) {
  const h = (now - Date.parse(iso)) / 3_600_000;
  if (!Number.isFinite(h) || h < 0) return 0;
  return Math.max(0, 1 - h / 48) * 6 + (h < 1 ? 4 : 0);
}

const REL = 9; // per matching term, up to 4

const W = (kind: WidgetKind, title: string, size: CardSize, extra: Partial<Widget> = {}): Widget => ({
  id: `b:${kind}:${extra.metric ?? ""}:${(extra.filter?.domains ?? []).join("")}`,
  kind,
  title,
  size,
  metric: null,
  filter: null,
  text: null,
  ...extra,
});

const DOMAIN_SHORT: Record<Domain, string> = { engineering: "Eng", sales: "Sales", marketing: "Marketing", ops: "Ops" };
const STATUS_SHORT: Record<Status, string> = { blocked: "blocked", at_risk: "at risk", on_track: "on track", done: "done", unknown: "unknown" };

const METRIC_TITLE: Record<WidgetMetric, string> = {
  total_nodes: "Nodes",
  blocked: "Blocked",
  at_risk: "At risk",
  on_track: "On track",
  done: "Done",
  sellable: "Sellable",
  sources_total: "Captures",
  sources_last_hour: "This hour",
  active_people: "Active people",
  gaps: "Gaps",
};

const METRIC_WORDS: Record<WidgetMetric, string> = {
  total_nodes: "total nodes work",
  blocked: "blocked risk blocker",
  at_risk: "risk at_risk blocked",
  on_track: "on track healthy",
  done: "done shipped",
  sellable: "sellable sales customer deal",
  sources_total: "captures sources activity",
  sources_last_hour: "captures activity live recent",
  active_people: "people active team",
  gaps: "gaps risk owner unowned",
};

const WIDGET_WORDS: Partial<Record<WidgetKind, string>> = {
  activity: "activity live feed captures sources recent",
  gaps: "gaps risk owner unowned blocked",
  people: "people team active person",
  constellation: "constellation embedding cluster topic semantic research",
  map: "map star graph",
  status_breakdown: "status blocked risk breakdown",
  domain_breakdown: "domain breakdown engineering sales marketing ops",
};

// ---- Build -----------------------------------------------------------------------------

export function buildBank(
  spec: DashboardSpec,
  terms: Set<string>,
  graph: GraphResponse | null,
  activity: ActivityResponse | null,
  sky: EmbeddingsResponse | null,
): Bank {
  const now = Date.now();
  const nodes = graph?.nodes ?? [];
  const pinned: Card[] = spec.widgets.slice(0, DECK_SIZE).map((w, i) => ({
    id: w.id,
    size: w.size,
    score: 1000 - i,
    sig: "",
    pinned: true,
    heavy: w.kind === "map" || w.kind === "constellation",
    kind: "widget",
    widget: w,
  }));

  // Anything the spec already shows unfiltered is not offered again.
  const specKinds = new Set(spec.widgets.filter((w) => !w.filter || Object.values(w.filter).every((v) => v == null)).map((w) => w.kind));
  const specMetrics = new Set(spec.widgets.filter((w) => w.kind === "kpi" && w.metric && !w.filter).map((w) => w.metric));

  const out: Card[] = [];
  const count = (pred: (n: PublicNode) => boolean) => nodes.reduce((a, n) => a + (pred(n) ? 1 : 0), 0);

  // KPI tiles, one per metric.
  if (graph || activity) {
    const metricValue: Record<WidgetMetric, number> = {
      total_nodes: nodes.length,
      blocked: count((n) => n.status === "blocked"),
      at_risk: count((n) => n.status === "at_risk"),
      on_track: count((n) => n.status === "on_track"),
      done: count((n) => n.status === "done"),
      sellable: count((n) => n.sellable),
      sources_total: activity?.counts.sources ?? 0,
      sources_last_hour: activity?.counts.lastHour ?? 0,
      active_people: activity?.counts.people ?? 0,
      gaps: graph?.gaps.length ?? 0,
    };
    for (const m of Object.keys(metricValue) as WidgetMetric[]) {
      if (specMetrics.has(m)) continue;
      const v = metricValue[m];
      const loud = (m === "blocked" || m === "at_risk" || m === "gaps") && v > 0;
      out.push({
        id: `b:kpi:${m}`,
        size: "sm",
        score: 5 + (loud ? 5 : 0) + (m === "sources_last_hour" && v > 0 ? 3 : 0) + REL * overlap(terms, METRIC_WORDS[m]),
        sig: String(v),
        kind: "widget",
        widget: W("kpi", METRIC_TITLE[m], "sm", { metric: m }),
      });
    }
  }

  // Domain x status tiles, only where something is there.
  if (graph) {
    for (const d of ["engineering", "sales", "marketing", "ops"] as Domain[]) {
      for (const s of ["blocked", "at_risk", "on_track", "done"] as Status[]) {
        const v = count((n) => n.domain === d && n.status === s);
        if (v === 0) continue;
        out.push({
          id: `b:combo:${d}:${s}`,
          size: "sm",
          score: 1 + Math.max(0, SEVERITY[s]) * 0.6 + REL * overlap(terms, `${d} ${s.replace("_", " ")}`),
          sig: String(v),
          kind: "widget",
          widget: {
            id: `b:combo:${d}:${s}`,
            kind: "kpi",
            title: `${DOMAIN_SHORT[d]} ${STATUS_SHORT[s]}`,
            size: "sm",
            metric: s as WidgetMetric,
            filter: { domains: [d], statuses: null, nodeIds: null, owner: null, query: null },
            text: null,
          },
        });
      }
    }
  }

  // Whole-org widgets the spec did not already include.
  const widgetCard = (kind: WidgetKind, title: string, size: CardSize, base: number, ready: boolean, heavy = false) => {
    if (specKinds.has(kind) || !ready) return;
    out.push({
      id: `b:w:${kind}`,
      size,
      score: base + REL * overlap(terms, WIDGET_WORDS[kind] ?? kind),
      sig: "",
      heavy,
      kind: "widget",
      widget: W(kind, title, size),
    });
  };
  widgetCard("activity", "Activity", "md", 7, !!activity);
  widgetCard("gaps", "Gaps", "md", graph && graph.gaps.length ? 5 : 0, !!graph);
  widgetCard("people", "People", "md", 3, !!activity);
  widgetCard("status_breakdown", "By status", "md", 4, !!graph);
  widgetCard("domain_breakdown", "By domain", "md", 3, !!graph);
  widgetCard("constellation", "Constellation", "lg", 2, true, true);
  widgetCard("map", "Map", "full", 0, true, true);

  // Important nodes: trouble first, then sellable and recently touched.
  const nodeCards: Card[] = nodes.map((n) => ({
    id: `b:node:${n.id}`,
    size: n.status === "blocked" ? "md" : "sm",
    score:
      2 +
      SEVERITY[n.status] +
      (n.sellable ? 2 + REL * overlap(terms, "sellable") * 0.5 : 0) +
      (n.owner ? 0 : 1) +
      recency(n.updatedAt, now) +
      REL * overlap(terms, `${n.label} ${n.summary} ${n.todo ?? ""} ${n.type} ${n.domain} ${n.owner ?? ""}`),
    sig: `${n.status}|${n.updatedAt}`,
    kind: "node",
    node: n,
  }));
  nodeCards.sort((a, b) => b.score - a.score);
  out.push(...nodeCards.slice(0, 14));

  // Per-person activity.
  const sources = activity?.sources ?? [];
  for (const p of (activity?.people ?? []).slice(0, 6)) {
    const mine = sources.filter((s) => (p.authorId ? s.authorId === p.authorId : s.authorName === p.name));
    const text = `${p.name} ${mine
      .slice(0, 6)
      .map((s) => `${s.title} ${s.changes.map((c) => c.label).join(" ")}`)
      .join(" ")}`;
    out.push({
      id: `b:person:${p.authorId ?? p.name}`,
      size: "sm",
      score: 2 + recency(p.lastAt, now) * 0.6 + Math.min(p.count, 10) * 0.2 + REL * overlap(terms, text),
      sig: p.lastAt,
      kind: "person",
      name: p.name,
      count: p.count,
      lastAt: p.lastAt,
      latest: mine[0] ?? null,
    });
  }

  // Topic clusters from the cached sky, if it has landed.
  if (sky && graph) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const members = new Map<string, PublicNode[]>();
    for (const pt of sky.points) {
      if (pt.kind !== "node" || !pt.clusterId) continue;
      const n = byId.get(pt.id);
      if (!n) continue;
      let arr = members.get(pt.clusterId);
      if (!arr) members.set(pt.clusterId, (arr = []));
      arr.push(n);
    }
    for (const c of sky.clusters.slice(0, 8)) {
      const top = (members.get(c.id) ?? []).sort((a, b) => SEVERITY[b.status] - SEVERITY[a.status]);
      if (!c.label) continue;
      out.push({
        id: `b:cluster:${c.id}`,
        size: "sm",
        score: 1.5 + Math.min(c.size, 12) * 0.15 + REL * overlap(terms, `${c.label} ${top.slice(0, 8).map((n) => n.label).join(" ")}`),
        sig: String(c.size),
        kind: "cluster",
        label: c.label,
        count: c.size,
        top: top.slice(0, 3),
      });
    }
  }

  // Recent status flips from captures.
  let flips = 0;
  for (const s of sources) {
    if (flips >= 8) break;
    for (const ch of s.changes) {
      if (!ch.statusFrom || ch.statusFrom === ch.statusTo) continue;
      flips++;
      const worse = SEVERITY[ch.statusTo] > SEVERITY[ch.statusFrom];
      out.push({
        id: `b:chg:${s.id}:${ch.nodeId}`,
        size: "sm",
        score: 3 + (worse ? 4 : 2) + recency(s.createdAt, now) + REL * overlap(terms, `${ch.label} ${s.title} ${s.authorName ?? ""}`),
        sig: ch.statusTo,
        kind: "change",
        source: s,
        change: ch,
      });
      if (flips >= 8) break;
    }
  }

  out.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  const ranked = focusOf(spec) ? inFocus(out, spec, nodes) : out;
  return { pinned, ranked: ranked.slice(0, BANK_SIZE) };
}

/**
 * An "only X" board from Orion: every widget is filtered except at most one activity feed. The deck then
 * fills its free slots with cards that pass those filters and nothing else, so "only marketing" stays marketing.
 */
export function focusOf(spec: DashboardSpec): boolean {
  if (spec.origin !== "chat") return false;
  const open = spec.widgets.filter((w) => !hasFilter(w.filter));
  return spec.widgets.length > open.length && open.every((w) => w.kind === "activity") && open.length <= 1;
}

function inFocus(cards: Card[], spec: DashboardSpec, nodes: PublicNode[]): Card[] {
  const ok = new Set<string>();
  for (const w of spec.widgets) if (hasFilter(w.filter)) for (const n of applyFilter(nodes, w.filter)) ok.add(n.id);
  return cards.filter((c) => (c.kind === "node" ? ok.has(c.node.id) : c.kind === "change" ? ok.has(c.change.nodeId) : false));
}

/** Stable key for "the user asked for something new". */
export const specKey = (spec: DashboardSpec) => `${spec.updatedAt}|${spec.title}|${spec.widgets.map((w) => w.id).join(",")}`;
