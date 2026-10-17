import { MAX_WIDGETS } from "@/contract/schemas";
import type { DashboardSpec, GraphResponse, Status, User, Widget, WidgetFilter } from "@/contract/types";
import { heuristicDashboard } from "./heuristic";
import { STATUS_TITLE, cap, filterTitle, lower, parseAsk } from "./parse";
import { sanitizeDashboard, widget } from "./widgets";

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
    ...(intent.sellable ? [widget("kpi", "Ready to sell", "sm", { id: "kpi-sellable", metric: "sellable", filter: scope ?? undefined })] : []),
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
            : cap(kinds.map((k) => KIND_DEFAULTS[k][0].toLowerCase()).join(" and ") || "Ready to sell");
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
