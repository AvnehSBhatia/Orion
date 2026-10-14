import { config } from "@/config";
import { dashboardSpec, MAX_WIDGETS } from "@/contract/schemas";
import {
  DOMAINS,
  STATUSES,
  WIDGET_KINDS,
  WIDGET_METRICS,
  WIDGET_SIZES,
  type DashboardOrigin,
  type DashboardSpec,
  type Domain,
  type GraphResponse,
  type Org,
  type Status,
  type User,
  type Widget,
  type WidgetFilter,
} from "@/contract/types";
import type { Store } from "@/db/store";
import { readGraph } from "@/graph/view";
import { plain } from "@/lib/text";
import { FAST_MODEL } from "@/llm/chat";
import { completeJson, nullable, type LlmClient } from "@/llm/openrouter";

// ---- Schemas the model writes against (strict JSON schema: every field required, null when unused) ----

export const WIDGET_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["id", "kind", "title", "size", "metric", "filter", "text"],
  properties: {
    id: { type: "string", description: "Short kebab-case id, unique in the dashboard." },
    kind: { type: "string", enum: [...WIDGET_KINDS] },
    title: { type: "string", description: "A few plain words." },
    size: { type: "string", enum: [...WIDGET_SIZES], description: "Columns of a 4-column grid: sm 1, md 2, lg 3, full 4." },
    metric: { ...nullable({ type: "string", enum: [...WIDGET_METRICS] }), description: "Required for kpi, else null." },
    filter: {
      ...nullable({
        type: "object",
        additionalProperties: false,
        required: ["domains", "statuses", "nodeIds", "owner", "query", "sinceHours", "source"],
        properties: {
          domains: nullable({ type: "array", items: { type: "string", enum: [...DOMAINS] } }),
          statuses: nullable({ type: "array", items: { type: "string", enum: [...STATUSES] } }),
          nodeIds: { ...nullable({ type: "array", items: { type: "string" } }), description: "Only ids from the node list you were given." },
          owner: { ...nullable({ type: "string" }), description: "Owner name, matched loosely." },
          query: { ...nullable({ type: "string" }), description: "Words matched against label and summary." },
          sinceHours: { ...nullable({ type: "number" }), description: "Only work updated in the last N hours (today 24, this week 168)." },
          source: { ...nullable({ type: "string" }), description: "Tool or site it was captured from, e.g. google ads, hubspot, code." },
        },
      }),
      description: "Which nodes the widget covers, or null for all.",
    },
    text: { ...nullable({ type: "string" }), description: "Body of a note widget, else null." },
  },
} as const;

export const DASHBOARD_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "subtitle", "widgets"],
  properties: {
    title: { type: "string", description: "Short dashboard title." },
    subtitle: { type: "string", description: "One plain sentence: what this dashboard is for." },
    widgets: { type: "array", items: WIDGET_JSON_SCHEMA, description: `At most ${MAX_WIDGETS} widgets, most important first.` },
  },
} as const;

/** How the widgets read, shared by the role composer and the chat tool. */
export const WIDGET_GUIDE = `Widget kinds:
- kpi: one big number, set metric (total_nodes, blocked, at_risk, on_track, done, sellable, sources_total, sources_last_hour, active_people, gaps). A filter narrows node metrics.
- status_breakdown: node statuses as a chart. domain_breakdown: nodes per domain (engineering, sales, marketing, ops).
- node_list: cards for the nodes that pass the filter (domains, statuses, nodeIds, owner, query, sinceHours, source).
- activity: live stream of what people capture and commit. people: who is active right now.
- constellation: 3D cloud of every node and document by meaning. map: the star map of work and how it connects.
- gaps: work with no owner and other risks. note: a short text you write (text).
Layout is a 4-column grid: sm 1 column, md 2, lg 3, full 4. Put four sm kpis on the first row, then the big views. Fill rows to 4 columns.`;

const ROLE_PROMPT = `You design the home dashboard for one person in an organization, from their role in their own words.
${WIDGET_GUIDE}
Pick what this person checks every morning. Examples: sales sees sellable features, deals, and what is at risk with customers; an engineer sees blocked and at risk engineering work, recent commits, and the map; a founder sees KPIs across every domain, the constellation, live activity, gaps, and who is active; ops sees ops risks, gaps, and owners.
Always include one activity widget and one constellation or map widget. Use 6 to ${MAX_WIDGETS} widgets. Do not use nodeIds; use domains, statuses, owner, or query so the dashboard stays live.
Titles are a few plain words in sentence case. Never use em dashes or exclamation marks.`;

// ---- Sanitizing ----

/** Drops node ids that are not allowed, then fixes up whatever the filter has left. */
function cleanFilter(f: WidgetFilter | null, allowedIds: Pick<ReadonlySet<string>, "has"> | null): WidgetFilter | null {
  if (!f) return null;
  const nodeIds = f.nodeIds && allowedIds ? f.nodeIds.filter((id) => allowedIds.has(id)) : f.nodeIds;
  const out: WidgetFilter = { ...f, nodeIds: nodeIds?.length ? nodeIds : null };
  // The additive fields are left out when unused, so older specs read back exactly as they were saved.
  if (out.sinceHours == null) delete out.sinceHours;
  if (out.source == null) delete out.source;
  return Object.values(out).every((v) => v === null) ? null : out;
}

/**
 * Validates a model- or UI-written spec. `allowedIds` (when given) is the set of real node ids the
 * spec may point at; others are dropped like sanitizeView does. Returns null when nothing usable is left.
 */
export function sanitizeDashboard(
  raw: unknown,
  { origin, allowedIds = null, now = new Date() }: { origin: DashboardOrigin; allowedIds?: Pick<ReadonlySet<string>, "has"> | null; now?: Date },
): DashboardSpec | null {
  const parsed = dashboardSpec.safeParse(raw);
  if (!parsed.success || !parsed.data.widgets.length) return null;
  const d = parsed.data;
  return {
    title: plain(d.title),
    subtitle: plain(d.subtitle),
    widgets: d.widgets.map((w) => ({
      ...w,
      title: plain(w.title),
      text: w.text ? plain(w.text) : null,
      filter: cleanFilter(w.filter, allowedIds),
    })),
    origin,
    updatedAt: now.toISOString(),
  };
}

/** Every role dashboard shows the swarm: one activity widget and one constellation or map. */
export function withLiveWidgets(spec: DashboardSpec): DashboardSpec {
  const widgets = [...spec.widgets];
  const has = (...kinds: Widget["kind"][]) => widgets.some((w) => kinds.includes(w.kind));
  const extra: Widget[] = [];
  if (!has("activity")) extra.push(widget("activity", "Live activity", "md"));
  if (!has("constellation", "map")) extra.push(widget("constellation", "Constellation", "md"));
  if (!extra.length) return spec;
  // Make room by dropping from the end, but never a live widget.
  const live = new Set<Widget["kind"]>(["activity", "constellation", "map"]);
  while (widgets.length + extra.length > MAX_WIDGETS) {
    const i = widgets.findLastIndex((w) => !live.has(w.kind));
    widgets.splice(i < 0 ? widgets.length - 1 : i, 1);
  }
  // Widget ids key the UI's animation, so an added one must not reuse an id the model already took.
  const ids = new Set(widgets.map((w) => w.id));
  for (const w of extra) {
    let id = w.id;
    for (let n = 2; ids.has(id); n++) id = `${w.id}-${n}`;
    ids.add(id);
    w.id = id;
  }
  return { ...spec, widgets: [...widgets, ...extra] };
}

// ---- Deterministic fallback ----

function widget(
  kind: Widget["kind"],
  title: string,
  size: Widget["size"],
  { id, metric = null, filter, text = null }: { id?: string; metric?: Widget["metric"]; filter?: Partial<WidgetFilter>; text?: string | null } = {},
): Widget {
  const f: WidgetFilter | null = filter
    ? { domains: null, statuses: null, nodeIds: null, owner: null, query: null, ...filter }
    : null;
  return { id: id ?? kind, kind, title, size, metric, filter: f, text };
}

const kpi = (metric: NonNullable<Widget["metric"]>, title: string, filter?: Partial<WidgetFilter>) =>
  widget("kpi", title, "sm", { id: `kpi-${metric}${filter?.domains ? `-${filter.domains.join("-")}` : ""}`, metric, filter });

const RISKY: Status[] = ["blocked", "at_risk"];
const only = (...domains: Domain[]) => ({ domains });

type Persona = "founder" | "sales" | "marketing" | "engineering" | "research" | "ops" | "general";

// Order matters: the first match wins, so "founder who also sells" reads as a founder.
const PERSONAS: [Persona, RegExp][] = [
  ["founder", /\b(founder|co-?founder|ceo|cto|coo|cpo|chief|president|general manager)\b/],
  ["sales", /\b(sales|sell\w*|account exec\w*|ae|sdr|bdr|business development|deals?|revenue|customer success|csm|partnerships?|renewals?)\b/],
  ["marketing", /\b(market\w*|growth|brand|content|campaigns?|seo|demand gen|comms|pr|social)\b/],
  ["engineering", /\b(engineer\w*|develop\w*|dev|devops|sre|programm\w*|software|backend|frontend|full-?stack|platform|infra\w*|code|coding|qa|tech lead)\b/],
  ["research", /\b(research\w*|scien\w*|ml|machine learning|ai|data|analyst|analytics|phd)\b/],
  ["ops", /\b(ops|operations?|supply|logistics|procurement|vendors?|suppliers?|finance|legal|hr|people ops|recruit\w*|admin\w*|program manag\w*|project manag\w*|pm)\b/],
];

export function personaOf(role: string): Persona {
  const text = role.toLowerCase();
  return PERSONAS.find(([, re]) => re.test(text))?.[0] ?? "general";
}

/** Whether the graph has work owned by this person, so "Assigned to you" is not an empty card. */
function ownsWork(user: User, graph: Pick<GraphResponse, "nodes"> | null): string | null {
  const first = user.name.split(/\s+/)[0]?.toLowerCase();
  if (!first || !graph) return null;
  return graph.nodes.some((n) => n.owner?.toLowerCase().includes(first)) ? user.name : null;
}

/** A good dashboard from keywords in the role alone. Used when the model is unavailable. */
export function heuristicDashboard(
  user: User,
  graph: Pick<GraphResponse, "nodes"> | null = null,
  now = new Date(),
): DashboardSpec {
  const mine = ownsWork(user, graph);
  const assigned = mine ? [widget("node_list", "Assigned to you", "full", { id: "mine", filter: { owner: mine } })] : [];
  const persona = personaOf(`${user.role} ${user.teamDescription}`);
  const by: Record<Persona, Omit<DashboardSpec, "origin" | "updatedAt">> = {
    founder: {
      title: "Company pulse",
      subtitle: "Every domain at a glance: what moves, what is stuck, and who is working on what.",
      widgets: [
        kpi("total_nodes", "Work in flight"),
        kpi("blocked", "Blocked"),
        kpi("at_risk", "At risk"),
        kpi("sources_last_hour", "Captures this hour"),
        widget("constellation", "Constellation", "lg"),
        widget("people", "Who is active", "sm"),
        widget("activity", "Live activity", "md"),
        widget("gaps", "Gaps and risks", "md"),
        widget("domain_breakdown", "Work by domain", "md"),
        widget("status_breakdown", "Status across the org", "md"),
        widget("node_list", "Blocked across the org", "full", { id: "blocked", filter: { statuses: RISKY } }),
      ],
    },
    sales: {
      title: "Sales desk",
      subtitle: "What you can sell today, deals that need you, and what changed for customers.",
      widgets: [
        kpi("sellable", "Sellable now"),
        kpi("at_risk", "Deals at risk", only("sales")),
        kpi("done", "Shipped features", only("engineering")),
        kpi("sources_last_hour", "Captures this hour"),
        widget("node_list", "Shipped and on track", "md", { id: "sellable", filter: { domains: ["engineering"], statuses: ["done", "on_track"] } }),
        widget("node_list", "Deals and accounts", "md", { id: "deals", filter: { domains: ["sales"] } }),
        widget("status_breakdown", "Deal health", "md", { id: "deal-health", filter: { domains: ["sales"] } }),
        widget("activity", "Live activity", "md"),
        ...assigned,
        widget("map", "Star map", "full"),
      ],
    },
    marketing: {
      title: "Marketing board",
      subtitle: "Campaigns, what product is ready to talk about, and what the team is doing now.",
      widgets: [
        kpi("on_track", "Campaigns on track", only("marketing")),
        kpi("at_risk", "Campaigns at risk", only("marketing")),
        kpi("sellable", "Ready to announce"),
        kpi("sources_last_hour", "Captures this hour"),
        widget("node_list", "Campaigns", "md", { id: "campaigns", filter: { domains: ["marketing"] } }),
        widget("node_list", "Shipped and on track", "md", { id: "launchable", filter: { domains: ["engineering"], statuses: ["done", "on_track"] } }),
        widget("activity", "Live activity", "md"),
        widget("status_breakdown", "Marketing status", "md", { id: "marketing-status", filter: { domains: ["marketing"] } }),
        ...assigned,
        widget("constellation", "Constellation", "full"),
      ],
    },
    engineering: {
      title: "Engineering board",
      subtitle: "Blocked and at risk engineering work, the latest commits, and how it all connects.",
      widgets: [
        kpi("blocked", "Blocked", only("engineering")),
        kpi("at_risk", "At risk", only("engineering")),
        kpi("done", "Done", only("engineering")),
        kpi("sources_last_hour", "Commits and captures"),
        widget("node_list", "Blocked engineering work", "md", { id: "blocked", filter: { domains: ["engineering"], statuses: RISKY } }),
        widget("activity", "Commits and captures", "md"),
        ...assigned,
        widget("status_breakdown", "Engineering status", "md", { id: "eng-status", filter: { domains: ["engineering"] } }),
        widget("gaps", "Unowned work", "md"),
        widget("map", "Star map", "full"),
      ],
    },
    research: {
      title: "Research lens",
      subtitle: "How the work clusters by meaning, what is new, and where the open questions are.",
      widgets: [
        kpi("total_nodes", "Nodes"),
        kpi("sources_total", "Documents"),
        kpi("sources_last_hour", "New this hour"),
        kpi("gaps", "Open gaps"),
        widget("constellation", "Constellation", "full"),
        widget("activity", "Latest documents", "md"),
        widget("domain_breakdown", "Work by domain", "md"),
        ...assigned,
        widget("gaps", "Open questions", "md"),
        widget("people", "Who is active", "md"),
      ],
    },
    ops: {
      title: "Operations board",
      subtitle: "Ops risks, work nobody owns, and who is moving things right now.",
      widgets: [
        kpi("at_risk", "Ops at risk", only("ops")),
        kpi("blocked", "Blocked", only("ops")),
        kpi("gaps", "Gaps"),
        kpi("active_people", "People active"),
        widget("node_list", "Ops at risk", "md", { id: "ops-risk", filter: { domains: ["ops"], statuses: RISKY } }),
        widget("gaps", "Unowned work", "md"),
        widget("activity", "Live activity", "md"),
        widget("people", "Who is active", "md"),
        ...assigned,
        widget("map", "Star map", "full"),
      ],
    },
    general: {
      title: "Your work",
      subtitle: "What is moving, what is stuck, and what your teammates are capturing.",
      widgets: [
        kpi("total_nodes", "Work in flight"),
        kpi("blocked", "Blocked"),
        kpi("at_risk", "At risk"),
        kpi("sources_last_hour", "Captures this hour"),
        ...assigned,
        widget("node_list", "Needs attention", "md", { id: "attention", filter: { statuses: RISKY } }),
        widget("activity", "Live activity", "md"),
        widget("status_breakdown", "Status", "md"),
        widget("map", "Star map", "full"),
      ],
    },
  };
  const spec = by[persona];
  return withLiveWidgets({ ...spec, widgets: spec.widgets.slice(0, MAX_WIDGETS), origin: "role", updatedAt: now.toISOString() });
}

/** When there is no person to compose for. */
export function defaultDashboard(now = new Date()): DashboardSpec {
  return { ...heuristicDashboard({ id: "", name: "", role: "", teamDescription: "" }, null, now), origin: "default" };
}

// ---- Composing from the role ----

function graphBrief(graph: GraphResponse): string {
  const count = <K extends string>(keys: K[]) => keys.reduce<Record<string, number>>((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {});
  const owners = Object.entries(count(graph.nodes.flatMap((n) => (n.owner ? [n.owner] : []))))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([o]) => o);
  return [
    `Nodes: ${graph.nodes.length}. By domain: ${JSON.stringify(count(graph.nodes.map((n) => n.domain)))}. By status: ${JSON.stringify(count(graph.nodes.map((n) => n.status)))}.`,
    `Sellable: ${graph.nodes.filter((n) => n.sellable).length}. Gaps: ${graph.gaps.length}. Owners: ${owners.join(", ") || "none yet"}.`,
  ].join("\n");
}

const ROLE_TIMEOUT_MS = 20_000;

export type ComposeDeps = { llm: LlmClient; model?: string; now?: Date };

/**
 * The person's default dashboard, designed by the chat model from their free-text role. Falls back to
 * `heuristicDashboard` on any model failure (no key, bad output), so it always returns something good.
 */
export async function composeRoleDashboard(
  user: User,
  org: Pick<Org, "name" | "description" | "context"> | null,
  graph: GraphResponse,
  { llm, model = config.chatModel, now = new Date() }: ComposeDeps,
): Promise<DashboardSpec> {
  try {
    // A slow provider must not hold the first page load hostage; the heuristic is good enough.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ROLE_TIMEOUT_MS}ms`)), ROLE_TIMEOUT_MS);
    });
    const raw = await Promise.race([completeJson(llm, {
      model,
      name: "dashboard",
      schema: DASHBOARD_JSON_SCHEMA,
      system: ROLE_PROMPT,
      user: [
        ...(org ? [`Organization: ${org.name}. What it does: ${org.description}${org.context ? ` ${org.context}` : ""}`] : []),
        `Person: ${user.name}. Their role, in their words: ${user.role}${user.teamDescription ? ` ${user.teamDescription}` : ""}`,
        `The work map now:\n${graphBrief(graph)}`,
      ].join("\n\n"),
      maxTokens: 2000,
    }), timeout]).finally(() => clearTimeout(timer));
    const spec = sanitizeDashboard(raw, { origin: "role", allowedIds: new Set(), now });
    if (spec && spec.widgets.length >= 3) return withLiveWidgets(spec);
    console.error(`Role dashboard for ${user.id} came back unusable, using the heuristic`);
  } catch (err) {
    console.error(`Role dashboard for ${user.id} failed, using the heuristic:`, err instanceof Error ? err.message : err);
  }
  return heuristicDashboard(user, graph, now);
}

// Concurrent polls for a person with no dashboard yet share one composition.
const inflight = new Map<string, Promise<DashboardSpec>>();

/** The saved dashboard, else one composed from the person's role (and saved). */
export async function resolveDashboard(store: Store, user: User, deps: ComposeDeps): Promise<DashboardSpec> {
  const saved = store.getDashboard(user.id);
  if (saved) return saved;
  const key = `${store.getOrg()?.id ?? ""}:${user.id}`;
  let pending = inflight.get(key);
  if (!pending) {
    pending = composeRoleDashboard(user, store.getOrg(), readGraph(store), deps)
      .then((spec) => {
        // A chat rebuild may have saved one while the model was composing; never overwrite it.
        const now = store.getDashboard(user.id);
        if (now) return now;
        store.saveDashboard(user.id, spec);
        return spec;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
}


// ---- Asking: reshape the dashboard from one message ----
// Two steps. `parseAsk` reads common requests (domain, status, owner, recency, source, "only", "add") with
// no model, so the board changes the moment the person hits enter. One small model call then refines the
// draft, and only when the parser left words it did not understand. A refinement that drops a filter the
// parser was sure of is rejected, so "blocked marketing" can never come back as all of marketing.

export type AskIntent = {
  groups: WidgetFilter[]; // one per thing asked for ("blocked marketing" and "Google Ads changes today")
  kinds: Widget["kind"][]; // widgets named outright ("the constellation", "who is active")
  sellable: boolean;
  only: boolean; // "only X" / "just X": nothing unrelated stays
  add: boolean; // "also show X" / "add X": keep the current board and put X first
  role: string | null; // "I am a growth marketer": reshape for the role
  leftover: string[]; // words the parser did not use; when empty, the draft is final and the model is skipped
};

const DOMAIN_WORDS: [Domain, RegExp][] = [
  ["marketing", /\b(marketing|campaigns?|growth|brand|seo)\b/g],
  ["sales", /\b(sales|deals?|pipeline|accounts?|customers?|prospects?|renewals?)\b/g],
  ["engineering", /\b(engineering|eng|dev|backend|frontend|infra|bugs?)\b/g],
  ["ops", /\b(ops|operations|finance|legal|hiring|vendors?|suppliers?|procurement)\b/g],
];

// Where work was captured from. The value is what the UI matches against a page URL or title.
const SOURCE_WORDS: [string, RegExp][] = [
  ["google ads", /\b(google ads?|adwords)\b/g],
  ["meta ads", /\b(meta|facebook|instagram) ads?\b/g],
  ["linkedin", /\blinked ?in\b/g],
  ["hubspot", /\bhub ?spot\b/g],
  ["salesforce", /\bsalesforce\b/g],
  ["crm", /\bcrm\b/g],
  ["code", /\b(github|git|commits?|pull requests?|prs?|code changes?|code)\b/g],
  ["jira", /\bjira\b/g],
  ["linear", /\blinear\b/g],
  ["figma", /\bfigma\b/g],
  ["notion", /\bnotion\b/g],
  ["slack", /\bslack\b/g],
  ["stripe", /\bstripe\b/g],
  ["google docs", /\bgoogle docs?\b/g],
];

const STATUS_WORDS: [Status[], RegExp][] = [
  [["blocked", "at_risk"], /\b(needs? attention|in trouble|problems?|risks|trouble)\b/g],
  [["blocked"], /\b(blocked|blockers?|blocking|stuck)\b/g],
  [["at_risk"], /\b(at[- ]risk|risky|slipping|behind)\b/g],
  [["on_track"], /\b(on[- ]track|healthy)\b/g],
  [["done"], /\b(done|shipped|completed?|finished)\b/g],
];

const KIND_WORDS: [Widget["kind"], RegExp][] = [
  ["constellation", /\b(constellation|clusters?|by meaning)\b/g],
  ["map", /\b(star ?map|map)\b/g],
  ["people", /\b(who is active|who's active|people|teammates)\b/g],
  ["gaps", /\b(gaps?|unowned|no owner|nobody owns)\b/g],
  ["activity", /\b(activity|live feed|feed|captures)\b/g],
  ["status_breakdown", /\b(status breakdown|by status)\b/g],
  ["domain_breakdown", /\b(by domain|per domain|domain breakdown)\b/g],
];

// Words that carry no filter: request verbs, fillers, and nouns that just mean "things".
const FILLER = new Set(
  ("a an the and or of in on for to from with by at about is are was be this that these those it its all every any " +
    "show me my see view display give get put pull up bring want need would like please can could you i we us our let " +
    "dashboard board page screen widget widgets card cards thing things stuff work items item tasks task everything " +
    "changes change changed updates updated update happening happened going new latest recent recently what whats " +
    "which there here now just only also add plus focus track watch monitor keep make set switch rebuild into " +
    "being been has have had owned owns own s").split(" "),
);

const TIME_WORDS: [number, RegExp][] = [
  [1, /\b(last|past|this) hour\b/g],
  [24, /\b(today'?s?|this morning|this afternoon|tonight|last 24 hours|past 24 hours|past day|last day)\b/g],
  [48, /\byesterday\b/g],
  [168, /\b(this|last|past) week\b/g],
  [720, /\b(this|last|past) month\b/g],
];

type Clause = { f: WidgetFilter; subject: boolean };

const emptyFilter = (): WidgetFilter => ({ domains: null, statuses: null, nodeIds: null, owner: null, query: null, sinceHours: null, source: null });
const hasAny = (f: WidgetFilter) => Object.values(f).some((v) => v !== null && v !== undefined);
const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Reads one clause, blanking every span it used so whatever is left over is visible. */
function parseClause(text: string, owners: string[], user: User): { f: WidgetFilter; rest: string } {
  let t = ` ${text} `;
  const f = emptyFilter();
  const take = (re: RegExp, on: (m: string[]) => void) => {
    t = t.replace(re, (...args: unknown[]) => {
      on(args.filter((a): a is string => typeof a === "string" || a === undefined) as string[]);
      return " ";
    });
  };
  // Quoted phrases and "about X" are a text query, read first so their words are not reused.
  take(/"([^"]{2,60})"|“([^”]{2,60})”/g, (m) => (f.query = (m[1] ?? m[2] ?? "").trim() || null));
  take(/\b(?:about|mentioning|related to|regarding|containing|named|called)\s+([a-z0-9][a-z0-9 .\-]{1,58}?)\s*$/g, (m) => (f.query ??= m[1].trim()));
  const n = t.match(/\b(?:last|past)\s+(\d{1,3})\s*(hours?|hrs?|h|days?|d|weeks?|w)\b/);
  if (n) {
    const unit = n[2][0];
    f.sinceHours = Number(n[1]) * (unit === "h" ? 1 : unit === "d" ? 24 : 168);
    t = t.replace(n[0], " ");
  }
  for (const [hours, re] of TIME_WORDS) take(re, () => (f.sinceHours ??= hours));
  for (const [source, re] of SOURCE_WORDS) take(re, () => (f.source ??= source));
  take(/\b(mine|assigned to me|i own|my (?:work|stuff|tasks|things|items|projects|deals|campaigns|tickets))\b/g, () => (f.owner = user.name));
  for (const owner of owners) {
    const parts = owner.toLowerCase().split(/\s+/);
    const names = uniq([parts.join(" "), parts[0]].filter((p) => p.length >= 3));
    for (const name of names) take(new RegExp(`\\b${escapeRe(name)}(?:'s)?\\b`, "g"), () => (f.owner ??= owner));
  }
  const statuses: Status[] = [];
  for (const [ss, re] of STATUS_WORDS) take(re, () => statuses.push(...ss));
  if (statuses.length) f.statuses = uniq(statuses);
  const domains: Domain[] = [];
  for (const [d, re] of DOMAIN_WORDS) take(re, () => domains.push(d));
  if (domains.length) f.domains = uniq(domains);
  return { f, rest: t };
}

/** Deterministic read of a dashboard ask. Never calls a model. */
export function parseAsk(message: string, user: User, graph: Pick<GraphResponse, "nodes">): AskIntent {
  const owners = uniq(graph.nodes.flatMap((n) => (n.owner ? [n.owner] : [])));
  if (user.name && !owners.includes(user.name)) owners.push(user.name);
  let text = message.toLowerCase().replace(/’/g, "'").replace(/[!?.]+\s*$/, "");
  const intent: AskIntent = { groups: [], kinds: [], sellable: false, only: false, add: false, role: null, leftover: [] };

  const role = text.match(/\b(?:i am|i'm|im|my role is|i work as)\s+(?:a|an|the)\s+(.{3,})$/);
  if (role) {
    intent.role = message.slice(message.length - role[1].length).trim();
    // The role heuristic is a fair instant board, but only the model reads "deep ML researcher" well.
    intent.leftover = [intent.role];
    return intent;
  }
  const flag = (re: RegExp, set: () => void) => {
    text = text.replace(re, () => {
      set();
      return " ";
    });
  };
  flag(/\b(only|just|nothing but|exclusively)\b/g, () => (intent.only = true));
  flag(/^\s*(?:also|add|plus|and)\b|\b(?:also|add|include)\b/g, () => (intent.add = true));
  flag(/\b(sellable|ready to sell|can sell|ready to announce)\b/g, () => (intent.sellable = true));
  for (const [kind, re] of KIND_WORDS) flag(re, () => intent.kinds.includes(kind) || intent.kinds.push(kind));

  const clauses: Clause[] = [];
  const leftover: string[] = [];
  for (const part of text.split(/\s*(?:,|;|&|\band\b|\bplus\b|\balong with\b|\bas well as\b)\s*/)) {
    const { f, rest } = parseClause(part, owners, user);
    leftover.push(...rest.split(/[^a-z0-9']+/).filter((w) => w.length > 1 && !FILLER.has(w)));
    if (hasAny(f)) clauses.push({ f, subject: !!(f.domains || f.owner || f.source || f.query) });
  }
  // "blocked and at risk sales": a clause with only statuses joins the next clause when that one has statuses too.
  for (let i = 0; i < clauses.length - 1; i++) {
    const a = clauses[i];
    const b = clauses[i + 1];
    if (!a.subject && a.f.statuses && !a.f.sinceHours && b.f.statuses) {
      b.f.statuses = uniq([...a.f.statuses, ...b.f.statuses]);
      clauses.splice(i--, 1);
    }
  }
  const seen = new Set<string>();
  for (const c of clauses) {
    const key = JSON.stringify(c.f);
    if (!seen.has(key)) {
      seen.add(key);
      intent.groups.push(c.f);
    }
  }
  intent.groups = intent.groups.slice(0, 4);
  intent.leftover = uniq(leftover);
  return intent;
}

// ---- Titles ----

const STATUS_TITLE: Record<Status, string> = { blocked: "blocked", at_risk: "at risk", on_track: "on track", done: "done", unknown: "unknown" };
const SOURCE_TITLE: Record<string, string> = {
  "google ads": "Google Ads",
  "meta ads": "Meta Ads",
  linkedin: "LinkedIn",
  hubspot: "HubSpot",
  salesforce: "Salesforce",
  crm: "CRM",
  code: "code",
  jira: "Jira",
  linear: "Linear",
  figma: "Figma",
  notion: "Notion",
  slack: "Slack",
  stripe: "Stripe",
  "google docs": "Google Docs",
};

function sinceTitle(h: number): string {
  if (h === 1) return "this hour";
  if (h === 24) return "today";
  if (h === 48) return "since yesterday";
  if (h === 168) return "this week";
  if (h === 720) return "this month";
  return h % 24 === 0 ? `last ${h / 24} days` : `last ${h} hours`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lower = (s: string) => (/^[A-Z][a-z]/.test(s) && !/^(Google|Meta|LinkedIn|HubSpot|Salesforce|CRM|Jira|Linear|Figma|Notion|Slack|Stripe)\b/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** "Blocked marketing work", "Google Ads changes today", "Priya Shah's work". */
export function filterTitle(f: WidgetFilter): string {
  const words: string[] = [];
  if (f.owner) words.push(`${f.owner}'s`);
  if (f.statuses) words.push(f.statuses.map((s) => STATUS_TITLE[s]).join(" and "));
  if (f.domains) words.push(f.domains.join(" and "));
  if (f.source) words.push(SOURCE_TITLE[f.source] ?? f.source);
  words.push(f.source || f.sinceHours ? "changes" : "work");
  if (f.query) words.push(`about ${f.query}`);
  if (f.sinceHours) words.push(sinceTitle(f.sinceHours));
  return cap(words.join(" ")).slice(0, 60);
}

// ---- Building the draft ----

const KIND_DEFAULTS: Record<Widget["kind"], [string, Widget["size"]]> = {
  kpi: ["Metric", "sm"],
  status_breakdown: ["Status", "md"],
  domain_breakdown: ["Work by domain", "md"],
  node_list: ["Work", "md"],
  activity: ["Live activity", "md"],
  constellation: ["Constellation", "lg"],
  map: ["Star map", "full"],
  gaps: ["Gaps and risks", "md"],
  people: ["Who is active", "md"],
  note: ["Note", "md"],
};

function slug(f: WidgetFilter): string {
  return [f.owner, ...(f.statuses ?? []), ...(f.domains ?? []), f.source, f.query, f.sinceHours ? `${f.sinceHours}h` : null]
    .filter(Boolean)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 30);
}

function groupWidgets(groups: WidgetFilter[]): Widget[] {
  const w = (kind: Widget["kind"], title: string, size: Widget["size"], f: WidgetFilter, metric: Widget["metric"] = null): Widget => ({
    id: `${kind === "kpi" ? `kpi-${metric}` : kind}-${slug(f)}`,
    kind,
    title,
    size,
    metric,
    filter: { ...f },
    text: null,
  });
  if (groups.length === 1) {
    const f = groups[0];
    const changes = !!(f.source || f.sinceHours);
    const kpis: Widget[] = [w("kpi", changes ? "Changed" : "In scope", "sm", f, "total_nodes")];
    const statuses = f.statuses ?? (["blocked", "at_risk", "done"] as Status[]);
    for (const s of statuses.slice(0, 3)) if (s !== "unknown") kpis.push(w("kpi", cap(STATUS_TITLE[s]), "sm", f, s));
    const title = filterTitle(f);
    return [
      ...kpis,
      w("node_list", title, kpis.length === 4 ? "full" : "lg", f),
      w("activity", changes ? `${title.replace(/ changes\b/, "")} feed`.slice(0, 60) : "Activity on this work", "md", f),
      ...(statuses.length > 1 ? [w("status_breakdown", "Status", "md", f)] : []),
    ];
  }
  const kpis = groups.map((f) => w("kpi", filterTitle(f), "sm", f, "total_nodes"));
  const lists = groups.flatMap((f) => [
    w("node_list", filterTitle(f), "md", f),
    ...(f.source || f.sinceHours ? [w("activity", `${filterTitle(f).replace(/ changes\b/, "")} feed`.slice(0, 60), "md", f)] : []),
  ]);
  return [...kpis, ...lists];
}

function kindWidget(kind: Widget["kind"], f: WidgetFilter | null): Widget {
  const [title, size] = KIND_DEFAULTS[kind];
  // A named widget next to a single filter is about that filter ("gaps in marketing"); views of the whole org are not.
  const scoped = f && (kind === "gaps" || kind === "status_breakdown" || kind === "activity") ? f : null;
  return widget(kind, title, size, { id: scoped ? `${kind}-${slug(scoped)}` : kind, filter: scoped ?? undefined });
}

/**
 * The instant dashboard for an ask, or null when the parser did not recognize anything (then only the
 * model can help) or the message asks to remove something (the model does removals).
 */
export function draftDashboard(
  user: User,
  message: string,
  current: DashboardSpec,
  graph: Pick<GraphResponse, "nodes">,
  now = new Date(),
  intent = parseAsk(message, user, graph),
): DashboardSpec | null {
  if (/\b(remove|hide|drop|delete|get rid of|without|fewer)\b/i.test(message)) return null;
  if (intent.role) {
    const spec = heuristicDashboard({ ...user, role: intent.role, teamDescription: "" }, graph, now);
    return { ...spec, origin: "chat" };
  }
  const { groups, kinds, only, add } = intent;
  if (!groups.length && !kinds.length && !intent.sellable) return null;
  const scope = groups.length === 1 ? groups[0] : null;
  const fresh: Widget[] = [
    ...(intent.sellable ? [widget("kpi", "Sellable now", "sm", { id: "kpi-sellable", metric: "sellable", filter: scope ?? undefined })] : []),
    ...groupWidgets(groups),
    ...kinds.filter((k) => !(k === "activity" && groups.length)).map((k) => kindWidget(k, scope)),
  ];
  if (intent.sellable && !groups.length) {
    fresh.push(widget("node_list", "Shipped and on track", "lg", { id: "sellable", filter: { domains: ["engineering"], statuses: ["done", "on_track"] } }));
  }
  const titles = groups.map(filterTitle);
  let widgets: Widget[];
  let title: string;
  let subtitle: string;
  if (add || (!groups.length && !only)) {
    // Keep the board, put the new widgets first, and drop old copies of what was re-added.
    const ids = new Set(fresh.map((w) => w.id));
    const kindsNow = new Set(fresh.filter((w) => !w.filter && w.kind !== "kpi").map((w) => w.kind));
    widgets = [...fresh, ...current.widgets.filter((w) => !ids.has(w.id) && !(kindsNow.has(w.kind) && !w.filter))];
    title = current.title;
    subtitle = current.subtitle;
  } else {
    widgets = fresh;
    // Without "only", one unfiltered live feed stays so the board still shows what the org is doing.
    if (!only && !widgets.some((w) => w.kind === "activity" && !w.filter)) widgets.push(widget("activity", "Live activity", "md", { id: "activity-all" }));
    title =
      titles.length === 1
        ? titles[0]
        : titles.length === 2
          ? `${titles[0]} and ${lower(titles[1])}`
          : titles.length
            ? "Your focus"
            : cap(kinds.map((k) => KIND_DEFAULTS[k][0].toLowerCase()).join(" and ") || "Sellable now");
    subtitle = titles.length ? `Showing ${titles.map(lower).join(", ")}.` : "What you asked to see.";
  }
  return sanitizeDashboard({ title: title.slice(0, 80), subtitle, widgets: widgets.slice(0, MAX_WIDGETS) }, { origin: "chat", now });
}

/** Every filter the parser was sure of must survive the model, else the refinement is dropped. */
export function keepsFilters(groups: WidgetFilter[], spec: DashboardSpec): boolean {
  const fs = spec.widgets.flatMap((w) => (w.filter ? [w.filter] : []));
  return groups.every((g) =>
    fs.some(
      (f) =>
        (!g.domains || g.domains.every((d) => f.domains?.includes(d))) &&
        (!g.statuses || g.statuses.every((s) => f.statuses?.includes(s))) &&
        (!g.owner || (f.owner ?? "").toLowerCase().includes(g.owner.split(/\s+/)[0].toLowerCase())) &&
        (!g.source || (f.source ?? "").toLowerCase().includes(g.source)) &&
        (!g.sinceHours || (!!f.sinceHours && f.sinceHours <= g.sinceHours * 2)) &&
        (!g.query || (f.query ?? "").toLowerCase().includes(g.query.toLowerCase())),
    ),
  );
}

/** "Only X": every widget carries a filter, except at most one activity feed. */
export function enforceOnly(spec: DashboardSpec): DashboardSpec {
  let feed = false;
  const widgets = spec.widgets.filter((w) => {
    if (w.filter) return true;
    if (w.kind === "activity" && !feed) return (feed = true);
    return false;
  });
  return widgets.length ? { ...spec, widgets } : spec;
}

const ASK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["change", "dashboard"],
  properties: {
    change: { type: "boolean", description: "true when the message asks to see, track, or change the dashboard, or states the person's role." },
    dashboard: DASHBOARD_JSON_SCHEMA,
  },
} as const;

const ASK_PROMPT = `You edit one person's dashboard from their message. Set change true when they ask to see, show, track, add, remove, or rebuild anything, or say who they are; then return the full new dashboard. Set change false for plain questions.
When a draft is given, it already has the filters the message names: keep them, fix titles, add what the message asks for that the draft missed, and drop what it did not ask for. Without a draft, start from the current dashboard and change only what was asked.
"Only X" or "just X": every widget is about X, plus at most one activity widget.
${WIDGET_GUIDE}
Filters: domains, statuses, owner (a name), query (words in label or summary), sinceHours (today 24, this week 168), source (tool it was captured from, like google ads, hubspot, code). Never use nodeIds. Use at most 8 widgets. The board title says what it shows, never the person's name. Titles are a few plain words in sentence case. No em dashes or exclamation marks. Reply with compact JSON on one line, no indentation.`;

// Words that mean a layout request. Anything else that reads as a plain question skips the model.
const LAYOUT_WORDS =
  /\b(show|dashboard|board|focus|track|view|only|just|add|remove|put|switch|rebuild|replace|swap|hide|pin|widgets?|chart|kpi|layout|display|see|watch|monitor|i am|i'm|im a|as a|my role)\b/i;
const QUESTION = /\?\s*$|^\s*(what|who|why|how|when|where|which|is|are|does|do|did|can|could|should|will|would)\b/i;

/** Cheap pre-check: true unless the message is clearly a plain question with no layout words. */
export function looksLikeLayoutRequest(message: string): boolean {
  return LAYOUT_WORDS.test(message);
}

/** A layout request, or a bare filter phrase like "blocked marketing work" that is not a question. */
function isAsk(message: string, intent: AskIntent): boolean {
  if (looksLikeLayoutRequest(message)) return true;
  return !QUESTION.test(message) && intent.groups.some((g) => g.domains || g.owner || g.source || g.statuses);
}

const ASK_TIMEOUT_MS = 8_000;
const ASK_LABELS = 30;

/** Non-null filter fields only, so the prompt stays small. */
function compactWidgets(widgets: Widget[]) {
  return widgets.map((w) => {
    const f = w.filter ? Object.fromEntries(Object.entries(w.filter).filter(([, v]) => v !== null && v !== undefined)) : null;
    return { kind: w.kind, title: w.title, size: w.size, ...(w.metric ? { metric: w.metric } : {}), ...(f && Object.keys(f).length ? { filter: f } : {}), ...(w.text ? { text: w.text } : {}) };
  });
}

function sourceHosts(graph: Pick<GraphResponse, "nodes">): string[] {
  const hosts = graph.nodes.map((n) => {
    if (n.sourceKind === "code") return "code";
    try {
      return new URL(n.sourceRef).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  });
  return uniq(hosts.filter((h): h is string => !!h)).slice(0, 12);
}

export type AskDeps = ComposeDeps & {
  /** Called with the instant draft before the model is asked, so the UI can show it right away. */
  onDraft?: (spec: DashboardSpec) => void;
};

export type AskTrace = { draft: boolean; modelCalls: number; promptChars: number; ms: number };

/**
 * Reshapes the dashboard for one message: the instant draft (handed to `onDraft`), then at most one
 * model call to refine it. Returns the final spec, or null when the message did not ask for a change.
 * Node ids are limited to the real graph.
 */
export async function askDashboard(
  user: User,
  message: string,
  current: DashboardSpec,
  graph: Pick<GraphResponse, "nodes">,
  { llm, model = FAST_MODEL, now = new Date(), onDraft }: AskDeps,
  trace?: AskTrace,
): Promise<DashboardSpec | null> {
  const t0 = Date.now();
  const intent = parseAsk(message, user, graph);
  if (!isAsk(message, intent)) return null;
  const parsed = draftDashboard(user, message, current, graph, now, intent);
  const draft = parsed && intent.only ? enforceOnly(parsed) : parsed;
  if (trace) trace.draft = !!draft;
  if (draft) onDraft?.(draft);
  // Everything in the message was understood: the draft is the answer, no model needed.
  if (draft && !intent.leftover.length) {
    if (trace) trace.ms = Date.now() - t0;
    return draft;
  }

  const owners = uniq(graph.nodes.flatMap((n) => (n.owner ? [n.owner] : []))).slice(0, 12);
  const userMsg = [
    `Person: ${user.name}. Role: ${user.role}`,
    `Owners: ${owners.join(", ") || "none"}. Sources: ${sourceHosts(graph).join(", ") || "none"}.`,
    draft
      ? `Draft: ${JSON.stringify({ title: draft.title, widgets: compactWidgets(draft.widgets) })}`
      : `Current dashboard: ${JSON.stringify({ title: current.title, widgets: compactWidgets(current.widgets) })}\nSome work: ${graph.nodes
          .slice(0, ASK_LABELS)
          .map((n) => n.label)
          .join("; ")}`,
    `Message: ${message}`,
  ].join("\n");
  if (trace) {
    trace.modelCalls = 1;
    trace.promptChars = ASK_PROMPT.length + userMsg.length;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ASK_TIMEOUT_MS}ms`)), ASK_TIMEOUT_MS);
    });
    const raw = (await Promise.race([
      completeJson(llm, { model, name: "dashboard_edit", schema: ASK_SCHEMA, system: ASK_PROMPT, user: userMsg, maxTokens: 2000 }),
      timeout,
    ])) as { change?: unknown; dashboard?: unknown } | null;
    if (!raw || raw.change !== true) return draft;
    let spec = sanitizeDashboard(raw.dashboard, { origin: "chat", allowedIds: new Set(graph.nodes.map((n) => n.id)), now });
    if (!spec) return draft;
    if (draft && !keepsFilters(intent.groups, spec)) {
      console.error(`Dashboard ask for ${user.id}: the model dropped a filter, keeping the draft`);
      return draft;
    }
    if (intent.only) spec = enforceOnly(spec);
    return spec;
  } catch (err) {
    console.error(`Dashboard ask for ${user.id} failed:`, err instanceof Error ? err.message : err);
    return draft;
  } finally {
    clearTimeout(timer);
    if (trace) trace.ms = Date.now() - t0;
  }
}

/**
 * askDashboard against the store: the draft is saved (and handed to `onDraft`) the moment it exists, and
 * the refined spec replaces it when the model returns, so the person's board survives a reload either way.
 */
export async function askAndSaveDashboard(store: Store, user: User, message: string, deps: AskDeps, trace?: AskTrace): Promise<DashboardSpec | null> {
  const graph = readGraph(store);
  const current = store.getDashboard(user.id) ?? heuristicDashboard(user, graph, deps.now);
  const next = await askDashboard(
    user,
    message,
    current,
    graph,
    {
      ...deps,
      onDraft: (draft) => {
        store.saveDashboard(user.id, draft);
        deps.onDraft?.(draft);
      },
    },
    trace,
  );
  if (next) store.saveDashboard(user.id, next);
  return next;
}
