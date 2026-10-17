"use client";

import type { ActivityResponse, DashboardSpec } from "@/lib/api/types";
import { plainTitle } from "@/lib/format";
import { agoShort, useNow } from "@/lib/time";
import { cn } from "@/lib/utils";
import { LayoutGrid, Sparkles, UserRound } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { createContext, memo, useContext } from "react";

/** True while polls are failing: live indicators say so instead of claiming "Live". */
export const StaleContext = createContext(false);

const EASE = [0.23, 1, 0.32, 1] as const;

const ORIGIN = {
  role: { label: "Role", icon: UserRound },
  chat: { label: "Orion", icon: Sparkles },
  default: { label: "Default", icon: LayoutGrid },
} as const;

export const DashboardHeader = memo(function DashboardHeader({ spec, activity }: { spec: DashboardSpec; activity: ActivityResponse | null }) {
  const reduce = useReducedMotion();
  const now = useNow(15000);
  const origin = ORIGIN[spec.origin] ?? ORIGIN.default;
  const OriginIcon = origin.icon;
  return (
    <header className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${spec.title}|${spec.updatedAt}`}
          initial={reduce ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -3 }}
          transition={{ duration: 0.16, ease: EASE }}
          className="flex min-w-0 items-center gap-2.5"
        >
          <h1 className="truncate text-[24px] leading-tight font-semibold tracking-[-0.035em] md:text-[28px]">{plainTitle(spec.title)}</h1>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px font-mono text-[9.5px] tracking-[0.08em] uppercase",
              spec.origin === "chat" ? "border-ink/40 text-ink" : "border-line-strong text-faint",
            )}
          >
            <OriginIcon className="size-2.5" strokeWidth={1.75} />
            {origin.label}
            {spec.updatedAt && <span className="text-faint normal-case">{agoShort(spec.updatedAt, now)}</span>}
          </span>
        </motion.div>
      </AnimatePresence>
      <Live activity={activity} />
    </header>
  );
});

function Live({ activity }: { activity: ActivityResponse | null }) {
  const stale = useContext(StaleContext);
  return (
    <div className="flex items-center gap-4 font-mono text-[11px] tracking-wide text-faint uppercase">
      <LiveDot on={!!activity && !stale} label={stale ? "Reconnecting" : activity ? "Live" : "Connecting"} />
      {activity && (
        <span className="tabular-nums">
          {activity.counts.nodes.toLocaleString("en-US")} projects · {activity.counts.sources.toLocaleString("en-US")} documents
        </span>
      )}
    </div>
  );
}

export function LiveDot({ on, label }: { on: boolean; label: string }) {
  const reduce = useReducedMotion();
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="relative flex size-1.5">
        {on && !reduce && (
          <motion.span
            className="absolute inset-0 rounded-full bg-ink"
            animate={{ scale: [1, 2.6], opacity: [0.5, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
          />
        )}
        <span className={cn("relative size-1.5 rounded-full", on ? "bg-ink" : "bg-faint")} />
      </span>
      {label}
    </span>
  );
}
