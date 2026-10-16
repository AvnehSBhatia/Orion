// Live graph data in the Star shape the map and the project page are drawn from.

import type { Domain, GraphResponse, PublicNode, Source } from "@/lib/api/types";
import { clip, host, isReadable, sourceLabel } from "@/lib/format";
import { statusLabel } from "@/lib/status";
import { ago, shortDate } from "@/lib/time";

/** A project's status on the map. "unknown" from the backend shows as on track (see LIVE_STATUS). */
export type StarStatus = "on_track" | "at_risk" | "blocked" | "done";

export type Update = { date: string; source: string; author: string; change: string };

export type Star = {
  id: string;
  label: string;
  domain: Domain;
  status: StarStatus;
  summary: string;
  todo: string | null;
  read: string;
  /** Where "What to read" links to. */
  readUrl?: string;
  updated: string;
  sellable: boolean;
  owner: string;
  due: string;
  tasks: { done: number; active: number; blocked: number; todo: number };
  updates: Update[];
  /** Weekly counts lined up with WEEKS. */
  series: { updates: number[]; mentions: number[] };
};

/** Mondays of the last 8 weeks, oldest first, so the activity chart always ends on this week. */
export const WEEK_STARTS: Date[] = (() => {
  const monday = new Date();
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return Array.from({ length: 8 }, (_, index) => {
    const start = new Date(monday);
    start.setDate(monday.getDate() - (7 - index) * 7);
    return start;
  });
})();

export const WEEKS = WEEK_STARTS.map((start) => start.toLocaleDateString("en-US", { month: "short", day: "numeric" }));

export function percentChange(series: number[]) {
  const last = series.at(-1) ?? 0;
  const previous = series.at(-2) ?? 0;
  if (previous === 0) return 0;
  return Math.round(((last - previous) / previous) * 1000) / 10;
}

const LIVE_STATUS: Record<PublicNode["status"], StarStatus> = {
  on_track: "on_track",
  at_risk: "at_risk",
  blocked: "blocked",
  done: "done",
  // Nothing has said otherwise yet, so treat it as moving rather than alarming anyone.
  unknown: "on_track",
};

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
    // The page it was captured from, unless that was a search or a new tab.
    const page = host(node.sourceRef) && isReadable(node.sourceRef) ? node.sourceRef : null;

    return {
      id: node.id,
      label: node.label,
      domain: node.domain,
      status: LIVE_STATUS[node.status],
      summary: node.summary || "No summary yet.",
      todo: node.todo,
      read: read?.title ?? (page ? clip(page.replace(/^https?:\/\//, ""), 60) : "Nothing linked yet"),
      readUrl: read?.url ?? page ?? undefined,
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
