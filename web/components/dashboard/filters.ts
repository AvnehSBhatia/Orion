// Which nodes and sources a widget's filter keeps.

import type { PublicNode, Source, WidgetFilter } from "@/lib/api/types";
import { STATUS_RANK } from "@/lib/status";

export function hasFilter(filter: WidgetFilter | null): filter is WidgetFilter {
  return !!filter && Object.values(filter).some((v) => v !== null && !(Array.isArray(v) && v.length === 0));
}

/** Every word of a source filter ("google ads") appears in the URL or title; "code" means commits. */
export function fromSource(source: string | null | undefined, kind: string, ref: string, title = ""): boolean {
  const want = source?.trim().toLowerCase();
  if (!want) return true;
  if (want === "code") return kind === "code";
  const hay = `${ref} ${title}`.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  return want.split(/\s+/).every((w) => hay.includes(w));
}

/** Within the last `hours`, or always when no window is set. */
export function within(iso: string, hours: number | null | undefined, now = Date.now()): boolean {
  if (!hours) return true;
  const t = Date.parse(iso);
  return Number.isFinite(t) && now - t <= hours * 3_600_000;
}

export function applyFilter(nodes: PublicNode[], filter: WidgetFilter | null, now = Date.now()): PublicNode[] {
  if (!hasFilter(filter)) return nodes;
  const owner = filter.owner?.trim().toLowerCase();
  const query = filter.query?.trim().toLowerCase();
  const ids = filter.nodeIds?.length ? new Set(filter.nodeIds) : null;
  return nodes.filter(
    (n) =>
      (!filter.domains?.length || filter.domains.includes(n.domain)) &&
      (!filter.statuses?.length || filter.statuses.includes(n.status)) &&
      (!ids || ids.has(n.id)) &&
      (!owner || (n.owner ?? "").toLowerCase().includes(owner)) &&
      (!query || `${n.label} ${n.summary}`.toLowerCase().includes(query)) &&
      fromSource(filter.source, n.sourceKind, n.sourceRef, n.label) &&
      within(n.updatedAt, filter.sinceHours, now),
  );
}

/**
 * A source belongs to a filtered widget when it passes the widget's own source and time window, and either
 * touched one of the filtered nodes, mentions the query, or the filter is only about source and time.
 */
export function sourceMatches(source: Source, nodeIds: Set<string>, filter: WidgetFilter | null, now = Date.now()): boolean {
  if (!hasFilter(filter)) return true;
  if (!fromSource(filter.source, source.kind, source.ref, source.title)) return false;
  if (!within(source.createdAt, filter.sinceHours, now)) return false;
  const nodeScoped = !!(filter.domains?.length || filter.statuses?.length || filter.nodeIds?.length || filter.owner || filter.query);
  if (!nodeScoped) return true;
  if (source.changes.some((c) => nodeIds.has(c.nodeId))) return true;
  const q = filter.query?.trim().toLowerCase();
  return !!q && `${source.title} ${source.excerpt}`.toLowerCase().includes(q);
}

export function byAttention(a: PublicNode, b: PublicNode) {
  return STATUS_RANK[a.status] - STATUS_RANK[b.status] || Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
}
