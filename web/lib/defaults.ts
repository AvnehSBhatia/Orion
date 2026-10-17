import type { DashboardSpec, OrgSummary, User } from "@/lib/api/types";
import { clip } from "@/lib/format";

/** Whichever org has the most people (a signed-in account sees only its own). */
export function defaultOrg(orgs: OrgSummary[]) {
  return [...orgs].sort((a, b) => b.members - a.members)[0] ?? null;
}

/** The signed-in person when they are in the list, else the first person. */
export function defaultUser(users: User[], preferred?: string | null) {
  return users.find((user) => user.id === preferred) ?? users[0] ?? null;
}

/** Shown until the backend answers with the saved one. Mirrors a role dashboard's shape. */
export function fallbackDashboard(user: User | null): DashboardSpec {
  const none = { metric: null, filter: null, text: null };
  return {
    title: user ? `${user.name.split(" ")[0]}'s view` : "Company overview",
    subtitle: user?.role ? clip(user.role, 120) : "Everything in motion across the company.",
    origin: "default",
    updatedAt: new Date(0).toISOString(),
    widgets: [
      { id: "kpi-nodes", kind: "kpi", title: "In the graph", size: "sm", ...none, metric: "total_nodes" },
      { id: "kpi-blocked", kind: "kpi", title: "Blocked", size: "sm", ...none, metric: "blocked" },
      { id: "kpi-hour", kind: "kpi", title: "Captures this hour", size: "sm", ...none, metric: "sources_last_hour" },
      { id: "kpi-people", kind: "kpi", title: "People active", size: "sm", ...none, metric: "active_people" },
      { id: "map", kind: "map", title: "Company map", size: "lg", ...none },
      { id: "activity", kind: "activity", title: "Live activity", size: "sm", ...none },
      { id: "status", kind: "status_breakdown", title: "By status", size: "md", ...none },
      {
        id: "blocked",
        kind: "node_list",
        title: "Blocked and at risk",
        size: "md",
        ...none,
        filter: { domains: null, statuses: ["blocked", "at_risk"], nodeIds: null, owner: null, query: null },
      },
    ],
  };
}
