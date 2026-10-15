// Where everything sits on the map: hubs on a ring, each team's projects fanned out past its hub.

import type { Domain } from "@/lib/api/types";
import { clip } from "@/lib/format";
import { MAP_DOMAINS } from "@/lib/domain";
import type { Star } from "@/lib/stars";
import { Code2, Handshake, Megaphone, Settings2, type LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";

export { clip };

export const RINGS = [198, 258, 340, 422];
export const HUB_RADIUS = 258;
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
export const ANGLE: Record<Domain, number> = { engineering: -135, marketing: -45, sales: 45, ops: 135 };
export const ICON: Record<Domain, LucideIcon> = {
  engineering: Code2,
  marketing: Megaphone,
  sales: Handshake,
  ops: Settings2,
};

export const CENTERED: CSSProperties = { transformBox: "fill-box", transformOrigin: "center" };

export function round(value: number) {
  return Math.round(value * 100) / 100;
}

export function place(angle: number, radius: number) {
  const radians = (angle * Math.PI) / 180;
  return { x: round(Math.cos(radians) * radius), y: round(Math.sin(radians) * radius) };
}

/** Progress of one item inside a reveal stage, as a CSS expression that resolves to 0..1. */
export function stage(name: string, start: number, speed: number) {
  return `clamp(0, calc((var(${name}, 1) - ${start}) * ${speed}), 1)`;
}

export function draw(progress: string): CSSProperties {
  return { strokeDasharray: 1, strokeDashoffset: `calc(1 - ${progress})` };
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

export function layout(stars: Star[], lit: Set<string>) {
  let order = 0;
  return MAP_DOMAINS.map((domain) => {
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

export type Groups = ReturnType<typeof layout>;

export function arc(radius: number, start: number, end: number) {
  const from = place(start, radius);
  const to = place(end, radius);
  const large = end - start > 180 ? 1 : 0;
  return `M ${from.x} ${from.y} A ${radius} ${radius} 0 ${large} 1 ${to.x} ${to.y}`;
}

export function frameFor(groups: Groups, ids: string[]) {
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
