"use client";

import { DOMAIN_LABEL, DOMAINS, type Domain, type Star } from "@/lib/stars";
import { gsap } from "gsap";
import { Code2, Handshake, Megaphone, Settings2, type LucideIcon } from "lucide-react";
import { type CSSProperties, forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";

const RINGS = [198, 258, 340, 422];
const HUB_RADIUS = 258;
const LEAF_RADIUS = 392;
// Degrees between neighbouring leaves, and the most a hub fans out either side of its axis.
const LEAF_STEP = 9;
const LEAF_FAN = 26;
// Labels are horizontal, so neighbours on one hub must sit at least this far apart vertically.
const LABEL_GAP = 62;
const Y_LIMIT = 428;
// Past this a hub shows its most urgent projects and a "+N more" count; the full list lives in Context.
const MAX_LEAVES = 6;
const RANK: Record<Star["status"], number> = { blocked: 0, at_risk: 1, on_track: 2, done: 3 };
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

function clip(label: string, max: number) {
  return label.length > max ? `${label.slice(0, max - 1).trimEnd()}…` : label;
}

/** The leaves a hub can show: anything lit first, then the most urgent, kept in a stable order so polling does not shuffle them. */
export function pickLeaves(all: Star[], lit: Set<string>, max: number) {
  if (all.length <= max) return { shown: all, hidden: 0 };
  const ranked = [...all].sort(
    (a, b) => Number(lit.has(b.id)) - Number(lit.has(a.id)) || RANK[a.status] - RANK[b.status] || a.label.localeCompare(b.label),
  );
  const keep = new Set(ranked.slice(0, max).map((star) => star.id));
  return { shown: all.filter((star) => keep.has(star.id)), hidden: all.length - max };
}

function layout(stars: Star[], lit: Set<string>) {
  let order = 0;
  return DOMAINS.map((domain) => {
    const angle = ANGLE[domain];
    const { shown, hidden } = pickLeaves(
      stars.filter((star) => star.domain === domain),
      lit,
      MAX_LEAVES,
    );
    const spread = Math.min(LEAF_FAN, ((shown.length - 1) * LEAF_STEP) / 2);
    const hub = place(angle, HUB_RADIUS);
    const spots = shown.map((_, index) => {
      const offset = shown.length === 1 ? 0 : (index / (shown.length - 1) - 0.5) * 2 * spread;
      return place(angle + offset, LEAF_RADIUS);
    });
    // Collision-avoid: push neighbours apart vertically, then recentre the column on the original arc.
    const byY = spots.map((_, i) => i).sort((a, b) => spots[a].y - spots[b].y);
    const ys = byY.map((i) => spots[i].y);
    for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + LABEL_GAP);
    let shift = byY.reduce((sum, i) => sum + spots[i].y, 0) / Math.max(1, ys.length) - ys.reduce((a, b) => a + b, 0) / Math.max(1, ys.length);
    if (ys.length) shift = Math.min(Y_LIMIT - ys[ys.length - 1], Math.max(-Y_LIMIT - ys[0], shift));
    byY.forEach((i, k) => (spots[i] = { x: spots[i].x, y: round(ys[k] + shift) }));
    const leaves = shown.map((star, index) => {
      const leaf = spots[index];
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
    return { domain, hub, label: place(angle, HUB_RADIUS + 88), leaves, hidden };
  });
}

type Groups = ReturnType<typeof layout>;

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

function frameFor(groups: Groups, ids: string[]) {
  const points = groups.flatMap((group) => group.leaves).filter((leaf) => ids.includes(leaf.star.id));
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
  const picked = DOMAINS.map((domain) => ({
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
