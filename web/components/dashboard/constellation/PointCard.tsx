"use client";

import type { GraphResponse, SourceDetail } from "@/lib/api/types";
import { DOMAIN_LABEL } from "@/lib/domain";
import { isHttp } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/status";
import { since } from "@/lib/time";
import { fetchSource, openNode, openSource } from "@/lib/viewer";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import type { Hover } from "./Constellation";

export function PointCard({
  point,
  orgId,
  graph,
  onClose,
}: {
  point: Hover;
  orgId: string;
  graph: GraphResponse | null;
  onClose: () => void;
}) {
  const node = point.kind === "node" ? graph?.nodes.find((n) => n.id === point.id) : undefined;
  const [src, setSrc] = useState<SourceDetail | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (point.kind !== "source") return;
    let alive = true;
    fetchSource(orgId, point.id).then(
      (d) => alive && setSrc(d),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [orgId, point.id, point.kind]);

  const ref = node?.sourceRef ?? src?.source.ref ?? "";
  const body = node ? node.summary : src ? src.source.excerpt || src.text.slice(0, 280) : "";
  const chips =
    point.kind === "node"
      ? [point.domain && DOMAIN_LABEL[point.domain], point.status && STATUS_LABEL[point.status], node?.todo && "Has todo"]
      : [src?.source.kind === "code" ? "Commit" : src?.source.kind === "digest" ? "Digest" : "Capture", point.cluster];
  const changes = src?.source.changes ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute top-12 right-4 z-20 w-[min(320px,calc(100%-2rem))] rounded-xl border border-line-strong bg-raised/95 p-3.5 text-[13px] shadow-[0_16px_40px_rgba(0,0,0,0.55)] backdrop-blur"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-1">
            {chips.filter(Boolean).map((c) => (
              <span key={String(c)} className="rounded-full border border-line px-1.5 py-px font-mono text-[10px] tracking-wide text-muted uppercase">
                {c}
              </span>
            ))}
          </div>
          <p className="mt-1.5 leading-snug font-medium text-ink">{src?.source.title || point.label}</p>
          <p className="mt-0.5 text-[12px] text-faint">
            {[node?.owner ?? point.author ?? src?.source.authorName, point.createdAt && since(point.createdAt)].filter(Boolean).join(" · ")}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mt-1 -mr-1 rounded-md px-1.5 text-[16px] leading-none text-faint transition-colors hover:text-ink"
        >
          ×
        </button>
      </div>
      {body ? (
        <p className="mt-2 line-clamp-5 text-[12.5px] leading-relaxed text-muted">{body}</p>
      ) : point.kind === "source" && !failed ? (
        <p className="mt-2 animate-pulse font-mono text-[10.5px] text-faint uppercase">Loading…</p>
      ) : null}
      {changes.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[12px] text-muted">
          {changes.slice(0, 3).map((c) => (
            <li key={c.nodeId} className="truncate">
              <span className="text-faint">{c.change === "created" ? "+" : "~"}</span> {c.label} · {STATUS_LABEL[c.statusTo]}
            </li>
          ))}
        </ul>
      )}
      {(
        <div className="mt-2.5 flex items-center gap-2 border-t border-line pt-2.5">
          <button
            type="button"
            onClick={() => (point.kind === "source" ? openSource(point.id) : openNode(point.id))}
            className="rounded-md bg-ink px-2 py-1 text-[12px] font-medium text-bg transition-opacity hover:opacity-85"
          >
            Open
          </button>
          {isHttp(ref) ? (
            <a href={ref} target="_blank" rel="noreferrer" className="rounded-md px-1.5 py-1 text-[12px] text-muted transition-colors hover:text-ink">
              ↗
            </a>
          ) : null}
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-faint" title={ref}>
            {isHttp(ref) ? ref.replace(/^https?:\/\/(www\.)?/, "") : ref}
          </span>
        </div>
      )}
    </motion.div>
  );
}
