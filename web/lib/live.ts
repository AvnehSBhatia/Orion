// Adapts live backend data (lib/orion.ts) to the Star shape the map and project page were designed around.
"use client";

import type { DashboardSpec, GraphResponse, OrgSummary, PublicNode, Source, User } from "@/lib/orion";
import { type Star, type Status, statusLabel, type Update, WEEK_STARTS } from "@/lib/stars";
import { useEffect, useState } from "react";

const DAY = 86_400_000;

/** "4s ago", "3 min ago", "yesterday", "Oct 2". `now` is passed in so callers can tick it. */
export function ago(iso: string, now = Date.now()) {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.floor((now - then) / DAY);
  if (days < 2) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  return shortDate(iso);
}

export function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Re-renders every `ms` so relative times stay honest. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(timer);
  }, [ms]);
  return now;
}

function host(ref: string) {
  try {
    return new URL(ref).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Where a source came from, short enough for a chip: "github.com", "Code", "Manual". */
export function sourceLabel(source: Pick<Source, "kind" | "ref">) {
  if (source.kind === "extension") return host(source.ref) ?? "Browser";
  if (source.kind === "code") return "Code";
  if (source.kind === "digest") return "Digest";
  return "Manual";
}

/** The one line the live header shows: "Kai Nakamura captured github.com/orion/pull/12". */
export function captureLine(source: Source) {
  const who = source.authorName ?? "Someone";
  if (source.kind === "code") return `${who} committed ${source.title}`;
  if (source.kind === "extension") {
    const path = source.ref.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
    return `${who} captured ${path || source.title}`;
  }
  return `${who} added ${source.title}`;
}

const LIVE_STATUS: Record<PublicNode["status"], Status> = {
  on_track: "on_track",
  at_risk: "at_risk",
  blocked: "blocked",
  done: "done",
  // Nothing has said otherwise yet, so treat it as moving rather than alarming anyone.
  unknown: "on_track",
};

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function weekOf(iso: string) {
  const t = Date.parse(iso);
  for (let index = WEEK_STARTS.length - 1; index >= 0; index--) {
    if (t >= WEEK_STARTS[index].getTime()) return index;
  }
  return -1;
}

function bucket(dates: string[]) {
  const counts = WEEK_STARTS.map(() => 0);
  for (const date of dates) {
    const index = weekOf(date);
    if (index >= 0) counts[index]++;
  }
  return counts;
}

function changeLine(source: Source, nodeId: string) {
  const change = source.changes.find((item) => item.nodeId === nodeId);
  const title = clip(source.title || source.excerpt || source.ref, 90);
  if (change?.statusFrom && change.statusFrom !== change.statusTo && change.statusTo !== "unknown" && change.statusFrom !== "unknown") {
    return `${title} (${statusLabel(LIVE_STATUS[change.statusFrom])} to ${statusLabel(LIVE_STATUS[change.statusTo]).toLowerCase()})`;
  }
  return change?.change === "created" ? `Started from ${title}` : title;
}

/**
 * Graph nodes to Stars. Task counts come from the node and its neighbours (a project's linked work),
 * updates from sources whose changes touched it, and the activity chart from real weekly counts.
 */
export function toStars(graph: GraphResponse | null, sources: Source[], now = Date.now()): Star[] {
  if (!graph) return [];
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const neighbours = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    if (!neighbours.has(edge.source)) neighbours.set(edge.source, new Set());
    if (!neighbours.has(edge.target)) neighbours.set(edge.target, new Set());
    neighbours.get(edge.source)!.add(edge.target);
    neighbours.get(edge.target)!.add(edge.source);
  }
  const touching = new Map<string, Source[]>();
  for (const source of sources) {
    for (const change of source.changes) {
      const list = touching.get(change.nodeId) ?? [];
      if (!list.includes(source)) list.push(source);
      touching.set(change.nodeId, list);
    }
  }

  return graph.nodes.map((node) => {
    const linked = [node, ...[...(neighbours.get(node.id) ?? [])].map((id) => byId.get(id)!)];
    const tasks = { done: 0, active: 0, blocked: 0, todo: 0 };
    for (const item of linked) {
      if (item.status === "done") tasks.done++;
      else if (item.status === "blocked") tasks.blocked++;
      else if (item.status === "unknown") tasks.todo++;
      else tasks.active++;
    }
    if (node.todo) tasks.todo++;

    const own = (touching.get(node.id) ?? []).slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const label = node.label.toLowerCase();
    const mentions = sources.filter(
      (source) =>
        !own.includes(source) &&
        (`${source.title} ${source.excerpt}`.toLowerCase().includes(label) ||
          source.changes.some((change) => neighbours.get(node.id)?.has(change.nodeId))),
    );
    const updates: Update[] = own.slice(0, 8).map((source) => ({
      date: shortDate(source.createdAt),
      source: sourceLabel(source),
      author: source.authorName ?? "Orion",
      change: changeLine(source, node.id),
    }));
    const read = node.readLinks[0];

    return {
      id: node.id,
      label: node.label,
      domain: node.domain,
      status: LIVE_STATUS[node.status],
      summary: node.summary || "No summary yet.",
      todo: node.todo,
      read: read?.title ?? (host(node.sourceRef) ? clip(node.sourceRef.replace(/^https?:\/\//, ""), 60) : "Nothing linked yet"),
      readUrl: read?.url ?? (host(node.sourceRef) ? node.sourceRef : undefined),
      updated: ago(node.updatedAt, now),
      sellable: node.sellable,
      owner: node.owner ?? "Unassigned",
      due: "Not set",
      tasks,
      updates,
      series: {
        updates: bucket([node.updatedAt, ...own.map((source) => source.createdAt)]),
        mentions: bucket(mentions.map((source) => source.createdAt)),
      },
    };
  });
}

// ---- Org + user defaults -------------------------------------------------------------

/** The single non-demo org (that is where the swarm lands), else whichever has the most people. */
export function defaultOrg(orgs: OrgSummary[]) {
  const real = orgs.filter((org) => org.id !== "demo");
  if (real.length === 1) return real[0];
  return [...orgs].sort((a, b) => b.members - a.members || Number(a.id === "demo") - Number(b.id === "demo"))[0] ?? null;
}

export const DEFAULT_USER = "avneh-bhatia";

export function defaultUser(users: User[]) {
  return users.find((user) => user.id === DEFAULT_USER) ?? users[0] ?? null;
}

export function readStored(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the choice just will not survive a reload.
  }
}

// ---- Role-aware prompts --------------------------------------------------------------

// First match wins, so the broadest seats (founders, execs) are checked before the functions they span.
const ROLE_PROMPTS: { match: RegExp; prompts: string[] }[] = [
  {
    match: /\b(founder|co-founder|ceo|coo|chief|head of|director|vp|executive)\b/i,
    prompts: ["What changed in the last hour?", "Where are we at risk this week?", "Build me a dashboard for a board update"],
  },
  {
    match: /\b(sales|account exec\w*|ae|sdr|revenue|deals?|customer success|partnerships?)\b/i,
    prompts: ["What can I promise customers this week?", "Which deals are blocked, and on what?", "Rebuild my dashboard around what I can sell"],
  },
  {
    match: /\b(marketing|marketer|growth|brand|content|campaigns?|seo)\b/i,
    prompts: ["What shipped that I can announce?", "What changed in campaigns today?", "Show me only sellable work on my dashboard"],
  },
  {
    match: /\b(ops|operations|security|compliance|finance|legal|hr|recruiting)\b/i,
    prompts: ["What is blocked on ops right now?", "Where are the ownership gaps?", "Focus my dashboard on risks and gaps"],
  },
  {
    match: /\b(engineer\w*|developer|dev|platform|infra\w*|backend|frontend|cto|ml|data)\b/i,
    prompts: ["What did the team commit in the last hour?", "What is blocked in engineering?", "Rebuild my dashboard around code changes"],
  },
];

export function promptsForRole(role: string | null | undefined) {
  const hit = role ? ROLE_PROMPTS.find((item) => item.match.test(role)) : undefined;
  return hit?.prompts ?? ["What changed today?", "What is blocked this week?", "Focus my dashboard on blocked work"];
}

/** Shown until the backend answers, and when it cannot be reached. Mirrors a role dashboard's shape. */
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
      { id: "blocked", kind: "node_list", title: "Blocked and at risk", size: "md", ...none, filter: { domains: null, statuses: ["blocked", "at_risk"], nodeIds: null, owner: null, query: null } },
    ],
  };
}
