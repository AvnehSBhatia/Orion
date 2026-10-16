import { MAX_WIDGETS } from "@/contract/schemas";
import type { DashboardSpec, Domain, GraphResponse, Status, User, Widget, WidgetFilter } from "@/contract/types";
import { widget, withLiveWidgets } from "./widgets";

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
        kpi("sellable", "Ready to sell"),
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
        kpi("total_nodes", "Work items"),
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
