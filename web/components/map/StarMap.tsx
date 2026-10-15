"use client";

import type { Domain } from "@/lib/api/types";
import { DOMAIN_LABEL } from "@/lib/domain";
import type { Star } from "@/lib/stars";
import { gsap } from "gsap";
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CoreNode } from "./CoreNode";
import { ANGLE, CENTERED, draw, frameFor, HUB_RADIUS, ICON, layout, place, RINGS, round, stage } from "./geometry";
import { Leaf } from "./Leaf";

export type MapCamera = {
  /** Scroll-scrubbed. 0 is the whole map, 1 is framed on these projects. */
  lookAt: (ids: string[], progress: number) => void;
  /** Glide from the current frame to these projects. */
  flyTo: (ids: string[]) => void;
};

type StarMapProps = {
  stars: Star[];
  highlightIds: string[];
  onSelect: (id: string) => void;
  /** Called from a hub's "+N more" when it cannot show every project. */
  onMore?: (domain: Domain) => void;
};

export const StarMap = forwardRef<MapCamera, StarMapProps>(
  function StarMap({ stars, highlightIds, onSelect, onMore }, ref) {
  const frameRef = useRef<SVGGElement>(null);
  const pose = useRef({ x: 0, y: 0, scale: 1 });
  const tween = useRef<gsap.core.Tween | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const litKey = highlightIds.join("|");
  const lit = useMemo(() => new Set(litKey ? litKey.split("|") : []), [litKey]);
  const groups = useMemo(() => layout(stars, lit), [stars, lit]);
  const hoverDomain = stars.find((star) => star.id === hoverId)?.domain;
  const active = stars.filter((star) => star.status !== "done").length;
  const aimed = highlightIds.length > 0;

  const write = (x: number, y: number, scale: number) => {
    pose.current = { x, y, scale };
    const frame = frameRef.current;
    if (!frame) return;
    frame.setAttribute("transform", `translate(${round(-x * scale)} ${round(-y * scale)}) scale(${round(scale)})`);
    const svg = frame.ownerSVGElement;
    if (!svg) return;
    const view = svg.getBoundingClientRect();
    if (view.width < 2) return;
    svg.querySelectorAll<SVGElement>("[data-cull]").forEach((node) => {
      if (node.dataset.lit === "true") {
        node.style.visibility = "";
        return;
      }
      const box = node.getBoundingClientRect();
      const inside =
        box.width > 1 &&
        box.left >= view.left - 1 &&
        box.right <= view.right + 1 &&
        box.top >= view.top - 1 &&
        box.bottom <= view.bottom + 1;
      node.style.visibility = inside ? "" : "hidden";
    });
  };

  useEffect(() => {
    return () => {
      tween.current?.kill();
    };
  }, []);

  useLayoutEffect(() => {
    const { x, y, scale } = pose.current;
    write(x, y, scale);
  });

  useImperativeHandle(ref, () => ({
    lookAt: (ids, progress) => {
      tween.current?.kill();
      const goal = frameFor(groups, ids);
      const t = Math.min(1, Math.max(0, progress));
      write(goal.x * t, goal.y * t, 1 + (goal.scale - 1) * t);
    },
    flyTo: (ids) => {
      const goal = frameFor(groups, ids);
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      tween.current?.kill();
      if (reduce) {
        write(goal.x, goal.y, goal.scale);
        return;
      }
      const from = { ...pose.current };
      const proxy = { t: 0 };
      tween.current = gsap.to(proxy, {
        t: 1,
        duration: 1.4,
        ease: "power3.inOut",
        onUpdate: () => {
          write(
            from.x + (goal.x - from.x) * proxy.t,
            from.y + (goal.y - from.y) * proxy.t,
            from.scale + (goal.scale - from.scale) * proxy.t,
          );
        },
      });
    },
  }));

  return (
    <svg
      viewBox="-540 -450 1080 900"
      className="h-full w-full select-none"
      shapeRendering="geometricPrecision"
      textRendering="geometricPrecision"
      role="group"
      aria-label="Map of company projects grouped by team"
    >
      <g ref={frameRef}>
      <g>
        {RINGS.map((radius, index) => {
          const t = stage("--reveal-rings", index * 0.15, 2);
          return (
            <circle
              key={radius}
              r={radius}
              fill="none"
              stroke="#3a3a3a"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              style={{ ...CENTERED, opacity: t, transform: `scale(calc(0.6 + 0.4 * ${t}))` }}
            />
          );
        })}
        {[0, 90].map((angle) => {
          const end = place(angle, RINGS[3]);
          return (
            <line
              key={angle}
              x1={-end.x}
              y1={-end.y}
              x2={end.x}
              y2={end.y}
              stroke="#2c2c2c"
              strokeDasharray="2 6"
              style={{ opacity: "var(--reveal-rings, 1)" }}
            />
          );
        })}
      </g>

      <g>
        {groups.map(({ domain, leaves }) => {
          const start = place(ANGLE[domain], 178);
          const end = place(ANGLE[domain], HUB_RADIUS - 54);
          const quiet = aimed && !leaves.some((leaf) => lit.has(leaf.star.id));
          return (
            <line
              key={domain}
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              pathLength={1}
              stroke={hoverDomain === domain ? "#a3a3a3" : "#5a5a5a"}
              strokeWidth={1.25}
              strokeOpacity={quiet ? 0.35 : 1}
              style={{ ...draw("var(--reveal-hubs, 1)"), transition: "stroke 200ms" }}
            />
          );
        })}
        {groups.flatMap(({ leaves }) =>
          leaves.map(({ star, branch }) => {
            const on = hoverId === star.id || lit.has(star.id);
            return (
              <line
                key={star.id}
                {...branch}
                pathLength={1}
                stroke={on ? "#d4d4d4" : aimed ? "#333" : "#6a6a6a"}
                strokeWidth={1.25}
                style={{ ...draw(stage("--reveal-stars", 0, 2)), transition: "stroke 200ms" }}
              />
            );
          }),
        )}
      </g>

      <CoreNode active={active} />

      <g>
        {groups.map(({ domain, hub, leaves }) => {
          const Icon = ICON[domain];
          const quiet = aimed && !leaves.some((leaf) => lit.has(leaf.star.id));
          return (
            <g
              key={domain}
              transform={`translate(${hub.x} ${hub.y})`}
              style={{ opacity: quiet ? "calc(var(--reveal-hubs, 1) * 0.28)" : "var(--reveal-hubs, 1)" }}
            >
              <g style={{ ...CENTERED, transform: "scale(calc(0.4 + 0.6 * var(--reveal-hubs, 1)))" }}>
                <circle r={52} fill="none" stroke="#2c2c2c" strokeDasharray="1.2 4.5" />
                <circle r={44} fill="none" stroke={hoverDomain === domain ? "#bdbdbd" : "#5a5a5a"} />
                <circle r={36} fill="#050505" stroke="#6a6a6a" />
                <circle r={27} fill="none" stroke="#242424" />
                {[0, 90, 180, 270].map((angle) => {
                  const inner = place(angle, 38);
                  const outer = place(angle, 48);
                  return (
                    <line
                      key={angle}
                      x1={inner.x}
                      y1={inner.y}
                      x2={outer.x}
                      y2={outer.y}
                      stroke="#3a3a3a"
                      strokeWidth={1}
                    />
                  );
                })}
                <Icon x={-12} y={-12} width={24} height={24} color="#f5f5f5" strokeWidth={1.5} />
              </g>
            </g>
          );
        })}
      </g>

      <g style={{ opacity: "var(--reveal-labels, 1)" }}>
        {groups.map(({ domain, label, leaves, hidden }) => {
          const quiet = aimed && !leaves.some((leaf) => lit.has(leaf.star.id));
          return (
            <g key={domain} opacity={quiet ? 0.28 : 1}>
              <text
                data-cull=""
                x={label.x}
                y={label.y + 5}
                textAnchor="middle"
                fill="#c8c8c8"
                stroke="#000"
                strokeWidth={10}
                paintOrder="stroke"
                style={{ fontFamily: "var(--font-geist-mono)", fontSize: 15, letterSpacing: "0.14em" }}
              >
                {DOMAIN_LABEL[domain].toUpperCase()}
              </text>
              {(hidden > 0 || leaves.length === 0) && (
                <text
                  data-cull=""
                  x={label.x}
                  y={label.y + 27}
                  textAnchor="middle"
                  fill={hidden > 0 ? "#8a8a8a" : "#4a4a4a"}
                  stroke="#000"
                  strokeWidth={8}
                  paintOrder="stroke"
                  role={hidden > 0 && onMore ? "button" : undefined}
                  tabIndex={hidden > 0 && onMore ? 0 : undefined}
                  className={hidden > 0 && onMore ? "cursor-pointer outline-none hover:fill-[#d4d4d4]" : undefined}
                  onClick={hidden > 0 ? () => onMore?.(domain) : undefined}
                  onKeyDown={(event) => {
                    if (hidden > 0 && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault();
                      onMore?.(domain);
                    }
                  }}
                  style={{ fontFamily: "var(--font-geist-mono)", fontSize: 12, letterSpacing: "0.12em" }}
                >
                  {hidden > 0 ? `+${hidden} MORE` : "NOTHING YET"}
                </text>
              )}
            </g>
          );
        })}
      </g>

      <g>
        {groups.flatMap(({ leaves }) =>
          leaves.map(({ star, x, y, order }) => (
            <Leaf
              key={star.id}
              star={star}
              x={x}
              y={y}
              reveal={stage("--reveal-stars", 0.4 + order * 0.03, 3)}
              lit={lit.has(star.id)}
              dimmed={aimed && !lit.has(star.id)}
              hover={hoverId === star.id}
              onHover={setHoverId}
              onSelect={onSelect}
            />
          )),
        )}
      </g>
      </g>
    </svg>
  );
});
