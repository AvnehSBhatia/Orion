"use client";

import type { Star } from "@/lib/stars";
import { CENTERED, clip, place } from "./geometry";

export function Leaf({
  star,
  x,
  y,
  reveal,
  lit,
  dimmed = false,
  hover,
  onHover,
  onSelect,
}: {
  star: Star;
  x: number;
  y: number;
  reveal: string;
  lit: boolean;
  dimmed?: boolean;
  hover: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  const right = x >= 0;
  const on = lit || hover;
  const labelX = right ? 46 : -46;
  return (
    <g
      data-cull=""
      data-lit={lit ? "true" : "false"}
      transform={`translate(${x} ${y})`}
      opacity={dimmed ? 0.22 : 1}
      role="button"
      tabIndex={0}
      aria-label={`${star.label}. ${star.summary}`}
      className="cursor-pointer outline-none [&:focus-visible_.focus-ring]:opacity-100"
      onClick={() => onSelect(star.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(star.id);
        }
      }}
      onMouseEnter={() => onHover(star.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(star.id)}
      onBlur={() => onHover(null)}
    >
      <circle r={48} fill="transparent" />
      <g style={{ ...CENTERED, opacity: reveal, transform: `scale(calc(0.2 + 0.8 * ${reveal}))` }}>
        {lit && (
          <circle data-pulse r={18} fill="none" stroke="#ededed" strokeWidth={1}>
            <animate attributeName="r" values="18;40" dur="2.2s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.7;0" dur="2.2s" repeatCount="indefinite" />
          </circle>
        )}
        <circle r={30} fill="none" stroke={on ? "#8a8a8a" : "#2a2a2a"} />
        <circle
          className="focus-ring"
          r={24}
          fill="none"
          stroke="#ededed"
          strokeOpacity={0.7}
          style={{ opacity: on ? 1 : 0, transition: "opacity 200ms" }}
        />
        {[45, 135, 225, 315].map((angle) => {
          const inner = place(angle, 16);
          const outer = place(angle, 27);
          return (
            <line
              key={angle}
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              stroke={on ? "#d4d4d4" : "#3a3a3a"}
              strokeWidth={1}
            />
          );
        })}
        <g style={{ ...CENTERED, transform: hover ? "scale(1.12)" : "scale(1)", transition: "transform 200ms var(--ease-out)" }}>
          <LeafMark status={star.status} r={13} />
        </g>
      </g>
      <g style={{ opacity: reveal }}>
        <text
          x={labelX}
          y={6}
          textAnchor={right ? "start" : "end"}
          fill={on ? "#ffffff" : "#f2f2f2"}
          style={{ fontSize: 21, fontWeight: 500, letterSpacing: "-0.01em", transition: "fill 200ms" }}
        >
          {clip(star.label, 22)}
        </text>
        {on && (
          <text x={labelX} y={30} textAnchor={right ? "start" : "end"} fill="#8a8a8a" style={{ fontSize: 15 }}>
            {star.updated}
          </text>
        )}
      </g>
    </g>
  );
}

export function LeafMark({ status, r }: { status: Star["status"]; r: number }) {
  if (status === "on_track") return <circle r={r} fill="#f0f0f0" />;
  if (status === "done") return <circle r={r} fill="#4a4a4a" />;
  if (status === "blocked")
    return (
      <circle r={r} fill="#000" stroke="#f0f0f0" strokeWidth={r / 5.5} strokeDasharray={`${r / 2.75} ${r / 3.2}`} />
    );
  return (
    <>
      <circle r={r} fill="#000" stroke="#f0f0f0" strokeWidth={r / 5.5} />
      <circle r={r * 0.41} fill="#f0f0f0" />
    </>
  );
}
