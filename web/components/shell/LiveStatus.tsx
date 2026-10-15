"use client";

import type { ActivityResponse, GraphResponse } from "@/lib/api/types";
import { captureLine } from "@/lib/format";
import { ago, useNow } from "@/lib/time";
import { cn } from "@/lib/utils";
import { openSource } from "@/lib/viewer";
import { AnimatePresence, motion } from "motion/react";

export type Connection = "live" | "reconnecting" | "down";

/** Pulse, counts, and the newest capture while connected; an honest "Reconnecting" when polls fail. */
export function LiveStatus({
  connection,
  lastOk,
  graph,
  activity,
  stars,
}: {
  connection: Connection;
  lastOk: number | null;
  graph: GraphResponse | null;
  activity: ActivityResponse | null;
  stars: number;
}) {
  const now = useNow(1000);
  const latest = activity?.sources[0];
  const fresh = latest ? now - Date.parse(latest.createdAt) < 15_000 : false;
  if (connection !== "live") {
    return (
      <span role="status" className="hidden items-center gap-2 font-mono text-[12px] tracking-wide text-faint uppercase md:flex">
        <span className="size-1.5 animate-pulse rounded-full bg-faint" />
        {connection === "down" ? "Can't reach Orion" : `Reconnecting${lastOk ? ` · updated ${ago(new Date(lastOk).toISOString(), now)}` : ""}`}
      </span>
    );
  }
  const nodes = activity?.counts.nodes ?? graph?.nodes.length ?? stars;
  const sources = activity?.counts.sources ?? 0;
  return (
    <span className="hidden min-w-0 items-center gap-3 md:flex">
      <span className="flex shrink-0 items-center gap-2 font-mono text-[12px] tracking-wide text-faint uppercase">
        <span className={cn("relative size-1.5 rounded-full", fresh ? "orion-live bg-ink text-ink" : "bg-muted")} />
        {nodes.toLocaleString("en-US")} projects · {sources.toLocaleString("en-US")} captures
      </span>
      {latest && (
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.button
            type="button"
            onClick={() => openSource(latest.id)}
            key={latest.id}
            initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="hidden max-w-[360px] min-w-0 truncate text-left text-[13px] text-muted transition-colors hover:text-ink xl:block"
            title={`Open ${latest.title}`}
          >
            {captureLine(latest)} <span className="text-faint">{ago(latest.createdAt, now)}</span>
          </motion.button>
        </AnimatePresence>
      )}
    </span>
  );
}

/** The strip under the header while polls fail: says the data on screen is old, and how old. */
export function ConnectionBanner({ connection, lastOk }: { connection: Exclude<Connection, "live">; lastOk: number | null }) {
  const now = useNow(1000);
  return (
    <div
      role="status"
      className="absolute inset-x-0 top-14 z-[15] flex h-[33px] items-center justify-center gap-2 border-b border-line bg-panel px-4 text-[13px] text-muted"
    >
      <span className="size-1.5 animate-pulse rounded-full bg-faint" />
      {connection === "down"
        ? "Can't reach Orion. Retrying…"
        : `Reconnecting… Showing data from ${lastOk ? ago(new Date(lastOk).toISOString(), now) : "earlier"}.`}
    </div>
  );
}
