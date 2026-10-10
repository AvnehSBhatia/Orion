"use client";

import { DOMAIN_LABEL, DOMAINS, type Domain, STARS, type Star } from "@/lib/stars";
import { gsap } from "gsap";
import { Code2, Handshake, Megaphone, Settings2, type LucideIcon } from "lucide-react";
import { type CSSProperties, forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";

const RINGS = [198, 258, 340, 422];
const HUB_RADIUS = 258;
const LEAF_RADIUS = 392;
const LEAF_SPREAD = 17;
const ANGLE: Record<Domain, number> = { engineering: -135, marketing: -45, sales: 45, ops: 135 };
const ICON: Record<Domain, LucideIcon> = {
  engineering: Code2,
  marketing: Megaphone,
  sales: Handshake,
  ops: Settings2,
};

const CENTERED: CSSProperties = { transformBox: "fill-box", transformOrigin: "center" };

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function place(angle: number, radius: number) {
  const radians = (angle * Math.PI) / 180;
  return { x: round(Math.cos(radians) * radius), y: round(Math.sin(radians) * radius) };
}

/** Progress of one item inside a reveal stage, as a CSS expression that resolves to 0..1. */
function stage(name: string, start: number, speed: number) {
  return `clamp(0, calc((var(${name}, 1) - ${start}) * ${speed}), 1)`;
}

function draw(progress: string): CSSProperties {
  return { strokeDasharray: 1, strokeDashoffset: `calc(1 - ${progress})` };
}

function layout() {
  let order = 0;
  return DOMAINS.map((domain) => {
    const angle = ANGLE[domain];
    const stars = STARS.filter((star) => star.domain === domain);
    const hub = place(angle, HUB_RADIUS);
    const leaves = stars.map((star, index) => {
      const offset = stars.length === 1 ? 0 : (index / (stars.length - 1) - 0.5) * 2 * LEAF_SPREAD;
      const leaf = place(angle + offset, LEAF_RADIUS);
      const length = Math.hypot(leaf.x - hub.x, leaf.y - hub.y);
      const ux = (leaf.x - hub.x) / length;
      const uy = (leaf.y - hub.y) / length;
      return {
        star,
        order: order++,
        ...leaf,
        branch: {
          x1: round(hub.x + ux * 52),
          y1: round(hub.y + uy * 52),
          x2: round(leaf.x - ux * 34),
          y2: round(leaf.y - uy * 34),
        },
      };
    });
    return { domain, hub, label: place(angle, HUB_RADIUS + 88), leaves };
  });
}

const GROUPS = layout();

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  return reduced;
}

function arc(radius: number, start: number, end: number) {
  const from = place(start, radius);
  const to = place(end, radius);
  const large = end - start > 180 ? 1 : 0;
  return `M ${from.x} ${from.y} A ${radius} ${radius} 0 ${large} 1 ${to.x} ${to.y}`;
}

function Orbit({
  radius,
  dash,
  dur,
  reverse = false,
  spin,
}: {
  radius: number;
  dash: string;
  dur: string;
  reverse?: boolean;
  spin: boolean;
}) {
  return (
    <g>
      {spin && (
        <animateTransform
          attributeName="transform"
          type="rotate"
          from={reverse ? "360" : "0"}
          to={reverse ? "0" : "360"}
          dur={dur}
          repeatCount="indefinite"
        />
      )}
      <circle r={radius} fill="none" stroke="#9a9a9a" strokeWidth={1.15} strokeDasharray={dash} strokeLinecap="round" />
      {!reverse &&
        [24, 156, 248].map((angle) => {
          const point = place(angle, radius);
          return <circle key={angle} cx={point.x} cy={point.y} r={angle === 156 ? 3.4 : 2.1} fill="#f2f2f2" />;
        })}
    </g>
  );
}

function CoreNode({ active }: { active: number }) {
  const spin = !useReducedMotion();
  const ticks = Array.from({ length: 96 }, (_, index) => {
    const major = index % 8 === 0;
    const mid = index % 4 === 0;
    const angle = (index / 96) * 360 - 90;
    const outer = place(angle, 172);
    const inner = place(angle, major ? 148 : mid ? 158 : 165);
    return (
      <line
        key={index}
        x1={inner.x}
        y1={inner.y}
        x2={outer.x}
        y2={outer.y}
        stroke={major ? "#d0d0d0" : mid ? "#5c5c5c" : "#303030"}
        strokeWidth={major ? 1.7 : 0.8}
        strokeLinecap="round"
      />
    );
  });

  return (
    <g
      style={{
        ...CENTERED,
        opacity: "var(--reveal-core, 1)",
        transform: "scale(calc(0.4 + 0.6 * var(--reveal-core, 1)))",
      }}
    >
      <defs>
        <filter id="core-bloom" x="-70%" y="-70%" width="240%" height="240%">
          <feGaussianBlur stdDeviation="12" />
        </filter>
        <radialGradient id="core-fill" cx="50%" cy="40%" r="64%">
          <stop offset="0%" stopColor="#222" />
          <stop offset="55%" stopColor="#0c0c0c" />
          <stop offset="100%" stopColor="#000" />
        </radialGradient>
      </defs>
      <circle r={96} fill="#f5f5f5" opacity={0.08} filter="url(#core-bloom)" />
      {ticks}
      <Orbit radius={144} dash="36 112" dur="72s" spin={spin} />
      <Orbit radius={126} dash="6 22" dur="104s" reverse spin={spin} />
      {[0, 90, 180, 270].map((angle) => {
        const inner = place(angle, 112);
        const outer = place(angle, 138);
        return <line key={angle} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke="#333" />;
      })}
      <path d={arc(156, -36, 78)} fill="none" stroke="#cfcfcf" strokeWidth={1.6} strokeLinecap="round" />
      <path d={arc(156, 128, 210)} fill="none" stroke="#4a4a4a" strokeWidth={1.25} strokeLinecap="round" />
      <path d={arc(112, 210, 320)} fill="none" stroke="#7a7a7a" strokeWidth={1.1} strokeLinecap="round" />
      <circle r={100} fill="url(#core-fill)" stroke="#737373" strokeWidth={1.25} />
      <circle r={86} fill="none" stroke="#2a2a2a" />
      <circle r={72} fill="none" stroke="#3a3a3a" strokeDasharray="1.4 4.6" />
      <circle r={56} fill="none" stroke="#242424" />
      <text
        y={14}
        textAnchor="middle"
        fill="#f7f7f7"
        style={{ fontSize: 68, fontWeight: 600, letterSpacing: "-0.05em" }}
      >
        {active}
      </text>
      <text
        y={44}
        textAnchor="middle"
        fill="#9a9a9a"
        style={{ fontFamily: "var(--font-geist-mono)", fontSize: 11, letterSpacing: "0.2em" }}
      >
        IN MOTION
      </text>
    </g>
  );
}

export type MapCamera = {
  /** Scroll-scrubbed. 0 is the whole map, 1 is framed on these projects. */
  lookAt: (ids: string[], progress: number) => void;
  /** Glide from the current frame to these projects. */
  flyTo: (ids: string[]) => void;
};

function frameFor(ids: string[]) {
  const points = GROUPS.flatMap((group) => group.leaves).filter((leaf) => ids.includes(leaf.star.id));
  if (points.length === 0) return { x: 0, y: 0, scale: 1 };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const padX = 190;
  const padY = 70;
  const width = Math.max(maxX - minX + padX * 2, 360);
  const height = Math.max(maxY - minY + padY * 2, 280);
  return {
    x: round((minX + maxX) / 2),
    y: round((minY + maxY) / 2),
    scale: round(Math.min(1.5, Math.max(1, Math.min(860 / width, 640 / height)))),
  };
}

export const StarMap = forwardRef<MapCamera, { highlightIds: string[]; onSelect: (id: string) => void }>(
  function StarMap({ highlightIds, onSelect }, ref) {
  const frameRef = useRef<SVGGElement>(null);
  const pose = useRef({ x: 0, y: 0, scale: 1 });
  const tween = useRef<gsap.core.Tween | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const lit = new Set(highlightIds);
  const hoverDomain = STARS.find((star) => star.id === hoverId)?.domain;
  const active = STARS.filter((star) => star.status !== "done").length;
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
      const goal = frameFor(ids);
      const t = Math.min(1, Math.max(0, progress));
      write(goal.x * t, goal.y * t, 1 + (goal.scale - 1) * t);
    },
    flyTo: (ids) => {
      const goal = frameFor(ids);
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
        {GROUPS.map(({ domain, leaves }) => {
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
        {GROUPS.flatMap(({ leaves }) =>
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
        {GROUPS.map(({ domain, hub, leaves }) => {
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
        {GROUPS.map(({ domain, label, leaves }) => (
          <text
            key={domain}
            data-cull=""
            x={label.x}
            y={label.y + 5}
            textAnchor="middle"
            fill="#c8c8c8"
            opacity={aimed && !leaves.some((leaf) => lit.has(leaf.star.id)) ? 0.28 : 1}
            stroke="#000"
            strokeWidth={10}
            paintOrder="stroke"
            style={{ fontFamily: "var(--font-geist-mono)", fontSize: 15, letterSpacing: "0.14em" }}
          >
            {DOMAIN_LABEL[domain].toUpperCase()}
          </text>
        ))}
      </g>

      <g>
        {GROUPS.flatMap(({ leaves }) =>
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

function Leaf({
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
          {star.label}
        </text>
        <text x={labelX} y={30} textAnchor={right ? "start" : "end"} fill="#8a8a8a" style={{ fontSize: 15 }}>
          {star.updated}
        </text>
      </g>
    </g>
  );
}

const ROW = 34;
const SECTION = 40 + 2 * ROW + 10;

export function CompactMap({
  highlightIds,
  onSelect,
}: {
  highlightIds: string[];
  onSelect: (id: string) => void;
}) {
  const lit = new Set(highlightIds);
  const active = STARS.filter((star) => star.status !== "done").length;
  const groups = DOMAINS.map((domain, index) => ({
    domain,
    y: 84 + index * SECTION,
    stars: STARS.filter((star) => star.domain === domain),
  }));
  const last = groups.at(-1)!;
  const height = last.y + 34 + last.stars.length * ROW;

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
      {groups.map(({ domain, y, stars }, groupIndex) => {
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
                    {star.label}
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

function LeafMark({ status, r }: { status: Star["status"]; r: number }) {
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

export function MapLegend() {
  const items = [
    { label: "On track", mark: <circle cx={6} cy={6} r={5} fill="#ededed" /> },
    {
      label: "At risk",
      mark: (
        <>
          <circle cx={6} cy={6} r={4.5} fill="none" stroke="#ededed" strokeWidth={1.25} />
          <circle cx={6} cy={6} r={2} fill="#ededed" />
        </>
      ),
    },
    {
      label: "Blocked",
      mark: <circle cx={6} cy={6} r={4.5} fill="none" stroke="#ededed" strokeWidth={1.25} strokeDasharray="2 2" />,
    },
    { label: "Done", mark: <circle cx={6} cy={6} r={5} fill="#4a4a4a" /> },
  ];
  return (
    <ul className="flex flex-col gap-1.5 font-mono text-[11px] tracking-wide text-faint uppercase">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2">
          <svg width={12} height={12} aria-hidden>
            {item.mark}
          </svg>
          {item.label}
        </li>
      ))}
    </ul>
  );
}
