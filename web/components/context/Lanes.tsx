"use client";

// Lineage: one lane per person over the last 2 minutes. Each dot is a capture or commit;
// filled when it created a node, ringed when it only updated one. Shows who feeds what.

import { initials, Quiet, useNow } from "@/components/dashboard/shared";
import type { ActivityResponse, Source } from "@/lib/orion";
import { useMemo } from "react";
import { SectionHead, Shell } from "./Chains";
import { openSource } from "./open";

const WINDOW_S = 120;
const WINDOW_MS = WINDOW_S * 1000;
const TICKS = [120, 90, 60, 30, 0]; // seconds ago

type Lane = { name: string; sources: Source[]; feeds: string[] };

function effect(s: Source): "created" | "updated" | "none" {
  if (s.changes.some((c) => c.change === "created")) return "created";
  return s.changes.length ? "updated" : "none";
}

export function Lanes({ activity, scope }: { activity: ActivityResponse | null; scope: Set<string> | null }) {
  const now = useNow(1000);
  const lanes = useMemo<Lane[]>(() => {
    if (!activity) return [];
    const from = now - WINDOW_MS;
    const by = new Map<string, Source[]>();
    for (const s of activity.sources) {
      const t = Date.parse(s.createdAt);
      if (!(t >= from)) continue;
      if (scope && !s.changes.some((c) => scope.has(c.nodeId))) continue;
      const name = s.authorName || "Unattributed";
      (by.get(name) ?? by.set(name, []).get(name)!).push(s);
    }
    // Order lanes like activity.people (most active first), then anyone else who appears.
    const order = activity.people.map((p) => p.name);
    const names = [...by.keys()].sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib) || by.get(b)!.length - by.get(a)!.length;
    });
    return names.map((name) => {
      const sources = by.get(name)!;
      const tally = new Map<string, number>();
      for (const s of sources) for (const c of s.changes) tally.set(c.label, (tally.get(c.label) ?? 0) + 1);
      return { name, sources, feeds: [...tally].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([l]) => l) };
    });
  }, [activity, scope, now]);

  const total = lanes.reduce((n, l) => n + l.sources.length, 0);

  return (
    <section>
      <SectionHead title="Who feeds what" note={total ? `${total} in 2 min` : "Last 2 min"} />
      <Shell>
        {lanes.length === 0 ? (
          <Quiet title={activity ? "Quiet for the last 2 minutes." : "Loading activity…"} />
        ) : (
          <div className="px-4 py-4 md:px-5">
            <div className="grid grid-cols-[minmax(0,9rem)_1fr] gap-x-4 md:grid-cols-[minmax(0,12rem)_1fr]">
              {lanes.map((lane) => (
                <LaneRow key={lane.name} lane={lane} now={now} />
              ))}
              <span />
              <div className="relative mt-1 h-4 font-mono text-[10px] text-faint">
                {TICKS.map((m) => (
                  <span key={m} className="absolute -translate-x-1/2 first:translate-x-0 last:-translate-x-full" style={{ left: `${((WINDOW_S - m) / WINDOW_S) * 100}%` }}>
                    {m === 0 ? "now" : `−${m}s`}
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-3 flex gap-4 text-[12px] text-faint">
              <span className="flex items-center gap-1.5"><Dot kind="created" /> Created a node</span>
              <span className="flex items-center gap-1.5"><Dot kind="updated" /> Updated one</span>
              <span className="flex items-center gap-1.5"><Dot kind="none" /> No change</span>
            </div>
          </div>
        )}
      </Shell>
    </section>
  );
}

function LaneRow({ lane, now }: { lane: Lane; now: number }) {
  return (
    <>
      <div className="flex min-w-0 items-center gap-2 border-b border-line py-2.5">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-raised font-mono text-[10px]">{initials(lane.name)}</span>
        <span className="min-w-0">
          <span className="block truncate text-[13px]">{lane.name}</span>
          {lane.feeds.length > 0 && <span className="block truncate text-[11px] text-faint">→ {lane.feeds.join(", ")}</span>}
        </span>
      </div>
      <div className="relative border-b border-line">
        <span aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-line" />
        {TICKS.slice(1, -1).map((m) => (
          <span key={m} aria-hidden className="absolute top-2 bottom-2 w-px bg-line" style={{ left: `${((WINDOW_S - m) / WINDOW_S) * 100}%` }} />
        ))}
        {lane.sources.map((s) => {
          const x = 1 - (now - Date.parse(s.createdAt)) / WINDOW_MS;
          const touched = s.changes.map((c) => `${c.change === "created" ? "+" : "~"} ${c.label}`).join("\n");
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => openSource(s.id)}
              title={`${s.title}${touched ? `\n${touched}` : ""}`}
              className="absolute top-1/2 grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full transition-transform duration-150 hover:scale-125"
              style={{ left: `${Math.min(1, Math.max(0, x)) * 100}%` }}
            >
              <Dot kind={effect(s)} />
            </button>
          );
        })}
      </div>
    </>
  );
}

function Dot({ kind }: { kind: "created" | "updated" | "none" }) {
  if (kind === "created") return <span className="block size-2.5 rounded-full bg-ink shadow-[0_0_6px_#ededed80]" />;
  if (kind === "updated") return <span className="block size-2.5 rounded-full border border-muted bg-bg" />;
  return <span className="block size-1.5 rounded-full bg-faint" />;
}
