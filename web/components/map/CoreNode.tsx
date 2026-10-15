"use client";

import { arc, CENTERED, place } from "./geometry";
import { useReducedMotion } from "./useReducedMotion";

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

export function CoreNode({ active }: { active: number }) {
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
