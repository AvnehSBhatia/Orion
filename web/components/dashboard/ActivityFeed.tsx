"use client";

// Live stream of what the org just captured or committed, newest first.
// Items present on first paint render still; anything that arrives afterwards slides in and glows once.

import { Quiet } from "@/components/ui/Quiet";
import { api } from "@/lib/api/client";
import type { Source, SourceChange } from "@/lib/api/types";
import { initials, shortRef } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/status";
import { agoShort, useNow } from "@/lib/time";
import { openSource } from "@/lib/viewer";
import { cn } from "@/lib/utils";
import { GitCommitHorizontal, Globe, Layers, PenLine } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";

const KIND_ICON = { extension: Globe, code: GitCommitHorizontal, manual: PenLine, digest: Layers } as const;
const KIND_LABEL = { extension: "Capture", code: "Commit", manual: "Note", digest: "Digest" } as const;

export function ActivityFeed({
  sources,
  orgId,
  limit = 12,
  loading = false,
  highlightIds = [],
  onSelectNode,
  className,
}: {
  sources: Source[];
  orgId?: string;
  limit?: number;
  loading?: boolean;
  highlightIds?: string[];
  onSelectNode?: (id: string) => void;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const now = useNow(1000);
  const shown = sources.slice(0, limit);

  // Anything stamped after this feed mounted is fresh and earns the arrival glow.
  const [mountedAt] = useState(() => Date.now());

  if (shown.length === 0) {
    return loading ? (
      <Quiet title="Connecting" className={className} />
    ) : (
      <Quiet title="Waiting for the first capture" className={className} />
    );
  }

  const hi = new Set(highlightIds);

  return (
    <ol className={cn("relative flex flex-col", className)} aria-live="polite">
      <AnimatePresence initial={false}>
        {shown.map((s) => {
          const Icon = KIND_ICON[s.kind] ?? Layers;
          const isNew = Date.parse(s.createdAt) > mountedAt;
          const touchesHighlight = s.changes.some((c) => hi.has(c.nodeId));
          return (
            <motion.li
              key={s.id}
              layout={reduce ? false : "position"}
              initial={reduce ? false : { opacity: 0, y: -14, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, transition: { duration: 0.12 } }}
              transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
              role="button"
              tabIndex={0}
              onClick={() => openSource(s.id)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), openSource(s.id))}
              className="group relative flex cursor-pointer gap-3 border-b border-line px-5 py-3 transition-colors duration-150 last:border-0 hover:bg-raised/40 focus-visible:bg-raised/40 focus-visible:outline-none"
            >
              {isNew && !reduce && (
                <motion.span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(237,237,237,0.07),transparent_70%)]"
                  initial={{ opacity: 1 }}
                  animate={{ opacity: 0 }}
                  transition={{ duration: 2.4, ease: "easeOut" }}
                />
              )}
              {touchesHighlight && <span aria-hidden className="absolute top-3 bottom-3 left-0 w-px bg-ink" />}
              <span className="relative mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-raised font-mono text-[10.5px] text-ink">
                {initials(s.authorName ?? s.authorId)}
                <span className="absolute -right-1 -bottom-1 flex size-3.5 items-center justify-center rounded-full border border-line bg-bg">
                  <Icon className="size-2 text-muted" strokeWidth={2} />
                </span>
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 text-[12px] text-faint">
                  <span className="truncate text-muted">{s.authorName ?? "Someone"}</span>
                  <span className="shrink-0">·</span>
                  <span className="truncate font-mono text-[11px]" title={s.ref}>
                    {shortRef(s.ref)}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums" title={new Date(s.createdAt).toLocaleString()}>
                    {agoShort(s.createdAt, now)}
                  </span>
                </div>
                <div className="mt-0.5 flex gap-3">
                  <p className="line-clamp-2 min-w-0 flex-1 text-[14px] leading-snug">
                    <span className="sr-only">{KIND_LABEL[s.kind]}: </span>
                    {s.title || s.excerpt || "Untitled"}
                  </p>
                  {s.hasImage && orgId && (
                    // eslint-disable-next-line @next/next/no-img-element -- remote capture thumbnail from the API
                    <img
                      src={api.sources.imageUrl(orgId, s.id)}
                      alt=""
                      loading="lazy"
                      className="h-9 w-14 shrink-0 rounded-md border border-line object-cover object-top opacity-80 grayscale transition duration-200 group-hover:opacity-100 group-hover:grayscale-0"
                    />
                  )}
                </div>
                {s.changes.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {s.changes.slice(0, 4).map((c) => (
                      <ChangeChip key={c.nodeId + c.change} change={c} lit={hi.has(c.nodeId)} onSelect={onSelectNode} />
                    ))}
                    {s.changes.length > 4 && (
                      <span className="px-1 py-0.5 font-mono text-[11px] text-faint">+{s.changes.length - 4}</span>
                    )}
                  </div>
                )}
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}

function ChangeChip({ change, lit, onSelect }: { change: SourceChange; lit: boolean; onSelect?: (id: string) => void }) {
  const moved = change.statusFrom && change.statusFrom !== change.statusTo;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.(change.nodeId);
      }}
      disabled={!onSelect}
      className={cn(
        "flex max-w-full items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-left text-[12px] transition-colors duration-150",
        lit ? "border-ink/60 text-ink" : "border-line-strong text-muted hover:border-faint hover:text-ink",
      )}
    >
      <span className="font-mono text-[10.5px] tracking-wide text-faint uppercase">{change.change}</span>
      <span className="truncate">{change.label}</span>
      {moved && (
        <span className="shrink-0 font-mono text-[11px] text-faint">
          · {STATUS_LABEL[change.statusFrom!].toLowerCase()}→<span className="text-ink">{STATUS_LABEL[change.statusTo].toLowerCase()}</span>
        </span>
      )}
    </button>
  );
}
