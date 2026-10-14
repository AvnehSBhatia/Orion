"use client";

// Shared vocabulary for the dynamic dashboard: tints, labels, filters, clocks, and the card shell.
// The product is monochrome; domain tints are the only color, kept low-chroma so they read as light, not paint.

import { StatusMark } from "@/components/StatusMark";
import type { Domain, PublicNode, Source, Status, WidgetFilter } from "@/lib/orion";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

export const DOMAINS: Domain[] = ["engineering", "sales", "marketing", "ops"];

export const DOMAIN_LABEL: Record<Domain, string> = {
  engineering: "Engineering",
  sales: "Sales",
  marketing: "Marketing",
  ops: "Ops",
};

export const DOMAIN_TINT: Record<Domain, string> = {
  engineering: "#94b4e8",
  sales: "#e3c08a",
  marketing: "#d99bb8",
  ops: "#93cbb0",
};

export const STATUSES: Status[] = ["blocked", "at_risk", "on_track", "done", "unknown"];

export const STATUS_LABEL: Record<Status, string> = {
  on_track: "On track",
  at_risk: "At risk",
  blocked: "Blocked",
  done: "Done",
  unknown: "Unknown",
};

// Grey ramp matching StatusMark: the louder the problem, the brighter the ink.
export const STATUS_TONE: Record<Status, string> = {
  blocked: "#ededed",
  at_risk: "#b5b5b5",
  on_track: "#7a7a7a",
  done: "#3e3e3e",
  unknown: "#262626",
};

// Lower sorts first: what needs attention leads.
export const STATUS_RANK: Record<Status, number> = { blocked: 0, at_risk: 1, on_track: 2, unknown: 3, done: 4 };

export function Mark({ status, size = 12 }: { status: Status; size?: number }) {
  if (status !== "unknown") return <StatusMark status={status} size={size} />;
  const r = size / 2 - 1;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#5a5a5a" strokeWidth={1} strokeDasharray="1 2" />
    </svg>
  );
}

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

export function initials(name: string | null | undefined) {
  if (!name) return "?";
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : (parts[0]?.[1] ?? ""))).toUpperCase() || "?";
}

/** Short, human relative time: "now", "42s", "7m", "3h", "2d". */
export function ago(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(s)) return "";
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** A clock that ticks every `ms`, so relative times stay honest without refetching. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Hostname for URLs, repo-ish tail for everything else. */
export function shortRef(ref: string) {
  try {
    const url = new URL(ref);
    return url.hostname.replace(/^www\./, "");
  } catch {
    const clean = ref.replace(/^(git@|https?:\/\/)/, "").replace(/\.git$/, "");
    const parts = clean.split(/[/:]/).filter(Boolean);
    return parts.slice(-2).join("/") || ref;
  }
}

export function WidgetCard({
  title,
  note,
  className,
  flush,
  children,
}: {
  title: string;
  note?: React.ReactNode;
  className?: string;
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("flex h-full min-h-0 flex-col rounded-2xl border border-line bg-panel", className)}>
      <div className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-3">
        <h2 className="truncate text-[14px] font-medium">{title}</h2>
        {note && <span className="shrink-0 font-mono text-[11px] tracking-wide text-faint uppercase">{note}</span>}
      </div>
      <div className={cn("min-h-0 flex-1", !flush && "px-5 pb-5")}>{children}</div>
    </section>
  );
}

/** Empty states should read as a calm instrument at rest, not an error. */
export function Quiet({ title, detail, className }: { title: string; detail?: string; className?: string }) {
  return (
    <div className={cn("flex h-full min-h-[96px] flex-col items-center justify-center gap-1.5 px-6 py-6 text-center", className)}>
      <svg width={28} height={28} viewBox="0 0 28 28" aria-hidden className="mb-1 opacity-70">
        <circle cx={14} cy={14} r={12.5} fill="none" stroke="#2e2e2e" strokeDasharray="1.2 3.6" />
        <circle cx={14} cy={14} r={2.2} fill="#5a5a5a" />
        <circle cx={22.5} cy={7} r={1.2} fill="#8f8f8f" />
      </svg>
      <p className="text-[14px] text-muted">{title}</p>
      {detail && <p className="max-w-[34ch] text-[13px] text-faint">{detail}</p>}
    </div>
  );
}
