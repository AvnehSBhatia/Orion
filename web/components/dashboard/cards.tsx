"use client";

// Compact bank cards: a title of a few words, one supporting line, numbers big.

import type { PublicNode, Source, SourceChange } from "@/lib/orion";
import { cn } from "@/lib/utils";
import { openSource } from "@/lib/viewer";
import { ArrowRight, Tag } from "lucide-react";
import { memo } from "react";
import { ago, DOMAIN_LABEL, DOMAIN_TINT, initials, Mark, STATUS_LABEL } from "./shared";

const SHELL =
  "group flex h-full min-h-[116px] w-full flex-col justify-between rounded-2xl border border-line bg-panel p-4 text-left transition-colors duration-150 hover:border-line-strong hover:bg-raised/40 focus-visible:border-line-strong focus-visible:outline-none";

function Foot({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 flex items-center gap-1.5 truncate font-mono text-[10.5px] tracking-wide text-faint uppercase">{children}</p>;
}

export const NodeCard = memo(function NodeCard({
  node: n,
  now,
  on,
  wide,
  onSelect,
}: {
  node: PublicNode;
  now: number;
  on: boolean;
  wide: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button type="button" onClick={() => onSelect(n.id)} className={cn(SHELL, on && "border-line-strong bg-raised/60")}>
      <div className="flex items-start gap-2.5">
        <span className="mt-1">
          <Mark status={n.status} size={wide ? 13 : 11} />
        </span>
        <span className={cn("min-w-0 flex-1 truncate font-medium", wide ? "text-[17px]" : "text-[14px]", on && "text-white")}>{n.label}</span>
        <span
          title={n.owner ?? "No owner"}
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[10px]",
            n.owner ? "bg-raised text-ink" : "border border-dashed border-line-strong text-faint",
          )}
        >
          {n.owner ? initials(n.owner) : "?"}
        </span>
      </div>
      <p className="mt-1.5 line-clamp-1 text-[13px] text-muted">{n.todo ?? n.summary}</p>
      <Foot>
        <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: DOMAIN_TINT[n.domain] }} />
        {DOMAIN_LABEL[n.domain]} · {STATUS_LABEL[n.status]}
        {n.sellable && <Tag className="size-2.5 shrink-0" />}
        <span className="ml-auto tabular-nums">{ago(n.updatedAt, now)}</span>
      </Foot>
    </button>
  );
});

export const PersonCard = memo(function PersonCard({
  name,
  count,
  lastAt,
  latest,
  now,
}: {
  name: string;
  count: number;
  lastAt: string;
  latest: Source | null;
  now: number;
}) {
  return (
    <button type="button" onClick={() => latest && openSource(latest.id)} className={SHELL}>
      <div className="flex items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-raised font-mono text-[10.5px]">{initials(name)}</span>
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{name}</span>
        <span className="text-[26px] leading-none font-semibold tracking-[-0.03em] tabular-nums">{count}</span>
      </div>
      {latest && <p className="mt-1.5 line-clamp-1 text-[13px] text-muted">{latest.title}</p>}
      <Foot>
        Captures <span className="ml-auto tabular-nums">{ago(lastAt, now)}</span>
      </Foot>
    </button>
  );
});

export const ClusterCard = memo(function ClusterCard({
  label,
  count,
  top,
  onSelect,
}: {
  label: string;
  count: number;
  top: PublicNode[];
  onSelect: (id: string) => void;
}) {
  const lead = top[0];
  return (
    <button type="button" onClick={() => lead && onSelect(lead.id)} className={SHELL}>
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 truncate text-[14px] font-medium">{label}</span>
        <span className="text-[26px] leading-none font-semibold tracking-[-0.03em] tabular-nums">{count}</span>
      </div>
      {top.length > 0 && <p className="mt-1.5 line-clamp-1 text-[13px] text-muted">{top.map((n) => n.label).join(" · ")}</p>}
      <Foot>Topic</Foot>
    </button>
  );
});

export const ChangeCard = memo(function ChangeCard({ source, change, now }: { source: Source; change: SourceChange; now: number }) {
  return (
    <button type="button" onClick={() => openSource(source.id)} className={SHELL}>
      <span className="truncate text-[14px] font-medium">{change.label}</span>
      <div className="mt-2 flex items-center gap-2 text-[13px]">
        {change.statusFrom && <Mark status={change.statusFrom} size={11} />}
        <span className="text-faint">{change.statusFrom ? STATUS_LABEL[change.statusFrom] : ""}</span>
        <ArrowRight className="size-3 text-faint" />
        <Mark status={change.statusTo} size={11} />
        <span className="text-ink">{STATUS_LABEL[change.statusTo]}</span>
      </div>
      <Foot>
        {source.authorName ? initials(source.authorName) : "Flip"}
        <span className="ml-auto tabular-nums">{ago(source.createdAt, now)}</span>
      </Foot>
    </button>
  );
});
