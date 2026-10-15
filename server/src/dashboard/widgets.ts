/**
 * Personal dashboards: a list of widgets per person, saved in the store.
 *
 *   widgets.ts    the widget schema the model writes against, sanitizing, and the `widget()` builder
 *   heuristic.ts  a good dashboard from keywords in a role, with no model
 *   compose.ts    the default dashboard, composed by the model from the person's role
 *   parse.ts      reads a request like "blocked marketing work today" into filters, with no model
 *   draft.ts      turns that reading into an instant dashboard
 *   ask.ts        "reshape my dashboard": the instant draft, then at most one model call to refine it
 */
import { MAX_WIDGETS, dashboardSpec } from "@/contract/schemas";
import { DOMAINS, STATUSES, WIDGET_KINDS, WIDGET_METRICS, WIDGET_SIZES, type DashboardOrigin, type DashboardSpec, type Widget, type WidgetFilter } from "@/contract/types";
import { plain } from "@/lib/text";
import { nullable } from "@/llm/openrouter";

// Strict JSON schema: every field is required, null when unused.
const WIDGET_JSON_SCHEMA = {
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

/** How the widgets read, shared by the role composer and the ask prompt. */
export const WIDGET_GUIDE = `Widget kinds:
- kpi: one big number, set metric (total_nodes, blocked, at_risk, on_track, done, sellable, sources_total, sources_last_hour, active_people, gaps). A filter narrows node metrics.
- status_breakdown: node statuses as a chart. domain_breakdown: nodes per domain (engineering, sales, marketing, ops).
- node_list: cards for the nodes that pass the filter (domains, statuses, nodeIds, owner, query, sinceHours, source).
- activity: live stream of what people capture and commit. people: who is active right now.
- constellation: 3D cloud of every node and document by meaning. map: the star map of work and how it connects.
- gaps: work with no owner and other risks. note: a short text you write (text).
Titles are for the reader, not for us: say "work items", "updates", "people"; never "node", "source", "embedding", or "cluster".
Layout is a 4-column grid: sm 1 column, md 2, lg 3, full 4. Put four sm kpis on the first row, then the big views. Fill rows to 4 columns.`;

const JARGON: [RegExp, string][] = [
  [/\bnodes\b/gi, "work items"],
  [/\bnode\b/gi, "work item"],
  [/\bsources\b/gi, "updates"],
  [/\bsource\b/gi, "update"],
];

/** Plain words for titles people read: the model and older saved specs sometimes say "At risk nodes". */
export function readable(text: string): string {
  const out = JARGON.reduce((t, [re, word]) => t.replace(re, word), plain(text));
  return out.charAt(0).toUpperCase() + out.slice(1);
}

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
    title: readable(d.title),
    subtitle: readable(d.subtitle),
    widgets: d.widgets.map((w) => ({
      ...w,
      title: readable(w.title),
      text: w.text ? plain(w.text) : null,
      filter: cleanFilter(w.filter, allowedIds),
    })),
    origin,
    updatedAt: now.toISOString(),
  };
}

/** Every role dashboard shows live work: one activity widget and one constellation or map. */
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

/** A widget with defaults filled in; a partial filter gets nulls for the fields it leaves out. */
export function widget(
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
