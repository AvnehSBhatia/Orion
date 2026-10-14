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
        required: ["domains", "statuses", "nodeIds", "owner", "query"],
        properties: {
          domains: nullable({ type: "array", items: { type: "string", enum: [...DOMAINS] } }),
          statuses: nullable({ type: "array", items: { type: "string", enum: [...STATUSES] } }),
          nodeIds: { ...nullable({ type: "array", items: { type: "string" } }), description: "Only ids from the node list you were given." },
          owner: { ...nullable({ type: "string" }), description: "Owner name, matched loosely." },
          query: { ...nullable({ type: "string" }), description: "Words matched against label and summary." },
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
- node_list: cards for the nodes that pass the filter (domains, statuses, nodeIds, owner, query).
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
  const out = { ...f, nodeIds: nodeIds?.length ? nodeIds : null };
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

// ---- Fast path: reshape the dashboard from one chat message ----

const ASK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["change", "dashboard"],
  properties: {
    change: { type: "boolean", description: "true only when the message asks to see, track, or change the dashboard, or states the person's role." },
    dashboard: DASHBOARD_JSON_SCHEMA,
  },
} as const;

const ASK_PROMPT = `You edit one person's dashboard from their message.
Set change true when they ask to see, show, track, focus on, add, remove, or rebuild anything, or tell you who they are ("I am a ML researcher"): then return the full new dashboard, starting from the current one and changing only what they asked (a role statement reshapes the whole board for that role). Keep an activity widget unless they ask to remove it.
"Only X" or "just X" means drop every widget not about X except one activity widget, and retitle the board for X.
Set change false for plain questions, and return the current dashboard unchanged.
${WIDGET_GUIDE}
filter.nodeIds may only hold ids from the node list; prefer domains, statuses, owner, or query so it stays live. Titles are a few plain words in sentence case. No em dashes or exclamation marks.`;

// Words that mean a layout request. Anything else that reads as a plain question skips the model.
const LAYOUT_WORDS =
  /\b(show|dashboard|board|focus|track|view|only|add|remove|put|switch|rebuild|replace|swap|hide|pin|widgets?|chart|kpi|layout|display|see|watch|monitor|i am|i'm|im a|as a|my role)\b/i;

/** Cheap pre-check: true unless the message is clearly a plain question with no layout words. */
export function looksLikeLayoutRequest(message: string): boolean {
  return LAYOUT_WORDS.test(message);
}

const ASK_TIMEOUT_MS = 15_000;
const ASK_NODES = 60;

/**
 * One structured model call that returns the reshaped dashboard, or null when the message did not ask for
 * a change (or the model failed). Node ids are limited to the real graph.
 */
export async function askDashboard(
  user: User,
  message: string,
  current: DashboardSpec,
  graph: Pick<GraphResponse, "nodes">,
  { llm, model = FAST_MODEL, now = new Date() }: ComposeDeps,
): Promise<DashboardSpec | null> {
  if (!looksLikeLayoutRequest(message)) return null;
  const nodes = graph.nodes.slice(0, ASK_NODES).map((n) => [n.id, n.label, n.domain, n.status, n.owner ?? "", n.sellable ? 1 : 0]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ASK_TIMEOUT_MS}ms`)), ASK_TIMEOUT_MS);
    });
    const raw = (await Promise.race([
      completeJson(llm, {
        model,
        name: "dashboard_edit",
        schema: ASK_SCHEMA,
        system: ASK_PROMPT,
        user: [
          `Person: ${user.name}. Role: ${user.role}`,
          `Current dashboard: ${JSON.stringify({ title: current.title, subtitle: current.subtitle, widgets: current.widgets.map(({ id, kind, title, size, metric, filter, text }) => ({ id, kind, title, size, metric, filter, text })) })}`,
          `Nodes [id,label,domain,status,owner,sellable]: ${JSON.stringify(nodes)}`,
          `Message: ${message}`,
        ].join("\n\n"),
        maxTokens: 1200,
      }),
      timeout,
    ])) as { change?: unknown; dashboard?: unknown } | null;
    if (!raw || raw.change !== true) return null;
    const known = new Set(graph.nodes.map((n) => n.id));
    return sanitizeDashboard(raw.dashboard, { origin: "chat", allowedIds: known, now });
  } catch (err) {
    console.error(`Dashboard ask for ${user.id} failed:`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** askDashboard against the store: edits the person's current dashboard and saves it when it changed. */
export async function askAndSaveDashboard(store: Store, user: User, message: string, deps: ComposeDeps): Promise<DashboardSpec | null> {
  if (!looksLikeLayoutRequest(message)) return null;
  const graph = readGraph(store);
  const current = store.getDashboard(user.id) ?? heuristicDashboard(user, graph, deps.now);
  const next = await askDashboard(user, message, current, graph, deps);
  if (next) store.saveDashboard(user.id, next);
  return next;
}
