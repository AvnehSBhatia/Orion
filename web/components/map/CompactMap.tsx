"use client";

import { DOMAIN_LABEL, MAP_DOMAINS } from "@/lib/domain";
import type { Star } from "@/lib/stars";
import { clip, draw, ICON, pickLeaves, stage } from "./geometry";
import { LeafMark } from "./Leaf";

const ROW = 34;
const COMPACT_LEAVES = 6;

export function CompactMap({
  stars: all,
  highlightIds,
  onSelect,
}: {
  stars: Star[];
  highlightIds: string[];
  onSelect: (id: string) => void;
}) {
  const lit = new Set(highlightIds);
  const active = all.filter((star) => star.status !== "done").length;
  const picked = MAP_DOMAINS.map((domain) => ({
    domain,
    ...pickLeaves(
      all.filter((star) => star.domain === domain),
      lit,
      COMPACT_LEAVES,
    ),
  }));
  // Each section is as tall as its own rows, so a busy team does not run into the next one.
  const tops = picked.reduce<number[]>((list, _, index) => {
    list.push(index === 0 ? 84 : list[index - 1] + 50 + Math.max(1, picked[index - 1].shown.length) * ROW);
    return list;
  }, []);
  const groups = picked.map(({ domain, shown, hidden }, index) => ({ domain, y: tops[index], stars: shown, hidden }));
  const last = groups.at(-1)!;
  const height = last.y + 34 + Math.max(1, last.stars.length) * ROW;

  return (
    <svg
      viewBox={`0 0 360 ${height}`}
      preserveAspectRatio="xMidYMin meet"
      className="h-full w-full select-none"
      shapeRendering="geometricPrecision"
      textRendering="geometricPrecision"
      role="group"
      aria-label="Map of company projects grouped by team"
    >
      <line
        x1={28}
        y1={50}
        x2={28}
        y2={last.y - 16}
        pathLength={1}
        stroke="#2a2a2a"
        strokeWidth={1.25}
        style={draw("var(--reveal-rings, 1)")}
      />
      <g style={{ opacity: "var(--reveal-core, 1)" }}>
        <circle cx={28} cy={28} r={22} fill="#0a0a0a" stroke="#333" />
        <text x={28} y={34} textAnchor="middle" fill="#f5f5f5" style={{ fontSize: 17, fontWeight: 600 }}>
          {active}
        </text>
        <text
          x={62}
          y={32}
          fill="#8f8f8f"
          style={{ fontFamily: "var(--font-geist-mono)", fontSize: 11, letterSpacing: "0.12em" }}
        >
          IN MOTION
        </text>
      </g>
      {groups.map(({ domain, y, stars, hidden }, groupIndex) => {
        const Icon = ICON[domain];
        return (
          <g key={domain}>
            <g style={{ opacity: stage("--reveal-hubs", groupIndex * 0.15, 2) }}>
              <circle cx={28} cy={y} r={16} fill="#000" stroke="#333" />
              <Icon x={21} y={y - 7} width={14} height={14} color="#f5f5f5" strokeWidth={1.5} />
            </g>
            <text
              x={56}
              y={y + 4}
              fill="#9a9a9a"
              style={{
                opacity: "var(--reveal-labels, 1)",
                fontFamily: "var(--font-geist-mono)",
                fontSize: 11,
                letterSpacing: "0.12em",
              }}
            >
              {DOMAIN_LABEL[domain].toUpperCase()}
              {hidden > 0 ? ` · +${hidden}` : stars.length === 0 ? " · NOTHING YET" : ""}
            </text>
            {stars.map((star, index) => {
              const leafY = y + 34 + index * ROW;
              const on = lit.has(star.id);
              const reveal = stage("--reveal-stars", (groupIndex * 2 + index) * 0.06, 2.4);
              return (
                <g
                  key={star.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${star.label}. ${star.summary}`}
                  className="cursor-pointer outline-none [&:focus-visible_.focus-ring]:opacity-100"
                  style={{ opacity: lit.size > 0 && !on ? `calc((${reveal}) * 0.28)` : reveal }}
                  onClick={() => onSelect(star.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(star.id);
                    }
                  }}
                >
                  <rect x={48} y={leafY - ROW / 2} width={312} height={ROW} fill="transparent" />
                  <path
                    d={`M60 ${index === 0 ? y + 12 : leafY - ROW} V${leafY} H70`}
                    fill="none"
                    stroke={on ? "#9a9a9a" : "#2a2a2a"}
                    strokeWidth={1.25}
                  />
                  {on && (
                    <circle data-pulse cx={80} cy={leafY} r={8} fill="none" stroke="#ededed">
                      <animate attributeName="r" values="8;16" dur="2.2s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.7;0" dur="2.2s" repeatCount="indefinite" />
                    </circle>
                  )}
                  <circle
                    className="focus-ring"
                    cx={80}
                    cy={leafY}
                    r={11}
                    fill="none"
                    stroke="#ededed"
                    strokeOpacity={0.5}
                    style={{ opacity: on ? 1 : 0 }}
                  />
                  <g transform={`translate(80 ${leafY})`}>
                    <LeafMark status={star.status} r={5.5} />
                  </g>
                  <text x={98} y={leafY + 5} fill={on ? "#ffffff" : "#dcdcdc"} style={{ fontSize: 15, fontWeight: 500 }}>
                    {clip(star.label, 26)}
                  </text>
                  <text x={356} y={leafY + 4} textAnchor="end" fill="#666" style={{ fontSize: 12 }}>
                    {star.updated}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
