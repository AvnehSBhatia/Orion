"use client";

import { WEEKS } from "@/lib/stars";
import { useState } from "react";

const W = 600;
const H = 200;

function path(series: number[], max: number) {
  return series
    .map((value, index) => {
      const x = Math.round((index / (series.length - 1)) * W * 100) / 100;
      const y = Math.round((H - (value / max) * H) * 100) / 100;
      return `${index === 0 ? "M" : "L"}${x} ${y}`;
    })
    .join(" ");
}

export function LineChart({ updates, mentions }: { updates: number[]; mentions: number[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const top = Math.ceil((Math.max(...updates, ...mentions) * 1.15) / 4) * 4;
  const ticks = [top, top / 2, 0];
  const line = path(updates, top);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-muted">
        <span className="flex items-center gap-2">
          <span className="h-px w-4 bg-ink" />
          Updates
        </span>
        <span className="flex items-center gap-2">
          <span className="w-4 border-t border-dashed border-muted" />
          Mentions
        </span>
      </div>
      <div className="flex gap-3">
        <div className="flex h-[200px] flex-col justify-between py-0 text-right font-mono text-[11px] text-faint">
          {ticks.map((tick) => (
            <span key={tick} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">
              {tick}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="h-[200px] w-full overflow-visible"
            onMouseLeave={() => setHover(null)}
            onMouseMove={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              const ratio = (event.clientX - box.left) / box.width;
              setHover(Math.max(0, Math.min(WEEKS.length - 1, Math.round(ratio * (WEEKS.length - 1)))));
            }}
            role="img"
            aria-label={`Updates and mentions for the last ${WEEKS.length} weeks`}
          >
            <defs>
              <linearGradient id="area" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#ededed" stopOpacity="0.14" />
                <stop offset="1" stopColor="#ededed" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0, 0.5, 1].map((ratio) => (
              <line
                key={ratio}
                x1={0}
                x2={W}
                y1={ratio * H}
                y2={ratio * H}
                stroke="#1f1f1f"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <path d={`${line} L${W} ${H} L0 ${H} Z`} fill="url(#area)" />
            <path
              d={path(mentions, top)}
              fill="none"
              stroke="#8f8f8f"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
            <path d={line} fill="none" stroke="#ededed" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            {hover !== null && (
              <line
                x1={(hover / (WEEKS.length - 1)) * W}
                x2={(hover / (WEEKS.length - 1)) * W}
                y1={0}
                y2={H}
                stroke="#5a5a5a"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
          {hover !== null && (
            <div
              className="pointer-events-none absolute top-2 z-10 min-w-[120px] rounded-lg border border-line-strong bg-raised px-3 py-2 text-[13px] shadow-lg"
              style={{
                left: `${(hover / (WEEKS.length - 1)) * 100}%`,
                transform: `translateX(${hover > WEEKS.length / 2 ? "calc(-100% - 10px)" : "10px"})`,
              }}
            >
              <p className="font-mono text-[11px] text-faint uppercase">Week of {WEEKS[hover]}</p>
              <p className="mt-1 flex justify-between gap-4">
                <span className="text-muted">Updates</span>
                <span className="font-mono">{updates[hover]}</span>
              </p>
              <p className="flex justify-between gap-4">
                <span className="text-muted">Mentions</span>
                <span className="font-mono">{mentions[hover]}</span>
              </p>
            </div>
          )}
          <div className="mt-2 flex justify-between font-mono text-[11px] text-faint">
            {WEEKS.map((week, index) => (
              <span key={week} className={index % 2 === 1 ? "hidden sm:inline" : undefined}>
                {week}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Donut({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const shown = parts.filter((part) => part.value > 0);
  const gap = shown.length > 1 ? 3 : 0;
  const lengths = shown.map((part) => (part.value / total) * circumference);
  const offsets = lengths.map((_, index) => lengths.slice(0, index).reduce((sum, length) => sum + length, 0));

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row lg:flex-col">
      <div className="relative size-[148px] shrink-0">
        <svg viewBox="0 0 140 140" className="size-full -rotate-90" role="img" aria-label="Tasks by status">
          <circle cx={70} cy={70} r={radius} fill="none" stroke="#141414" strokeWidth={14} />
          {shown.map((part, index) => (
            <circle
              key={part.label}
              cx={70}
              cy={70}
              r={radius}
              fill="none"
              stroke={part.color}
              strokeWidth={14}
              strokeDasharray={`${Math.max(0, lengths[index] - gap)} ${circumference}`}
              strokeDashoffset={-offsets[index]}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[28px] font-semibold tracking-[-0.03em]">{total}</span>
          <span className="font-mono text-[11px] tracking-wide text-faint uppercase">Tasks</span>
        </div>
      </div>
      <ul className="w-full space-y-2.5 text-[14px]">
        {parts.map((part) => (
          <li key={part.label} className="flex items-center gap-3">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: part.color }} />
            <span className="flex-1 text-muted">{part.label}</span>
            <span className="font-mono">{part.value}</span>
            <span className="w-10 text-right font-mono text-faint">
              {total ? Math.round((part.value / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
