"use client";

// The embedding constellation: every node and captured source, projected to 3D by the backend (PCA),
// drawn as a slowly turning point cloud. Nodes are stars tinted by domain; sources are dust tinted by
// cluster, each tethered to its nearest star. New points fly in from the dark and flare as they land.
// Canvas 2D with additive blending, so draw order never matters and nothing has to be depth-sorted.

import type { Domain, EmbeddingPoint, GraphResponse, Status } from "@/lib/api/types";
import { DOMAIN_LABEL, DOMAIN_TINT, DOMAINS } from "@/lib/domain";
import { STATUS_LABEL } from "@/lib/status";
import { since } from "@/lib/time";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { clamp, easeOut, rgb } from "./math";
import { PointCard } from "./PointCard";
import { useSky } from "./sky";

const CAMERA = 4.5; // eye distance from origin, in embedding units
const AUTO_SPIN = 0.07; // rad/s
const INTRO_MS = 450; // first load fades in across this window
const FADE_MS = 350;
const FLARE_MS = 1800;
const NODE_R: Record<Status, number> = { blocked: 3.4, at_risk: 3, on_track: 2.5, unknown: 2.1, done: 1.8 };
const DUST = ["#8fa8c8", "#c8b08f", "#b89ac0", "#8fc0b0", "#c09a8f", "#a8b88f", "#8fb8c8", "#c0a8b0"];
const DUST_LOOSE = "#6a6a6a";

type P = {
  id: string;
  kind: "node" | "source";
  label: string;
  domain: Domain | null;
  status: Status | null;
  clusterId: string | null;
  author: string | null;
  createdAt: string;
  tx: number; // target position (latest projection)
  ty: number;
  tz: number;
  x: number; // drawn position, eased toward the target
  y: number;
  z: number;
  born: number;
  flare: boolean;
  color: string;
  r: number;
  near: P | null;
  sx: number; // per-frame screen projection
  sy: number;
  k: number;
  fog: number;
  vis: number;
};

type Scene = {
  all: P[];
  byId: Map<string, P>;
  nodes: P[];
  dust: Map<string, P[]>;
  clusters: { id: string; label: string; size: number }[];
};

export type Hover = { id: string; kind: P["kind"]; label: string; domain: Domain | null; status: Status | null; author: string | null; createdAt: string; cluster: string | null };

export function Constellation({
  orgId,
  highlightIds,
  onSelect,
  graph,
  className,
}: {
  orgId: string;
  highlightIds: string[];
  onSelect: (id: string) => void;
  graph?: GraphResponse | null;
  className?: string;
}) {
  const { data, error } = useSky(orgId);
  const [pinned, setPinned] = useState<Hover | null>(null);
  const pinRef = useRef<(h: Hover | null) => void>(setPinned);

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const scene = useRef<Scene>({ all: [], byId: new Map(), nodes: [], dust: new Map(), clusters: [] });
  const loaded = useRef(false);
  const hiRef = useRef<Set<string>>(new Set());
  const selectRef = useRef(onSelect);
  const [hover, setHover] = useState<Hover | null>(null);
  const [landed, setLanded] = useState<{ n: number; at: number } | null>(null);
  const [counts, setCounts] = useState({ nodes: 0, sources: 0, clusters: 0 });

  useEffect(() => {
    selectRef.current = onSelect;
  }, [onSelect]);
  useEffect(() => {
    hiRef.current = new Set(highlightIds);
  }, [highlightIds]);
  useEffect(() => {
    if (!pinned) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPinned(null);
    const onAway = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setPinned(null);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onAway);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onAway);
    };
  }, [pinned]);

  // Merge each poll into the live scene: keep drawn positions, retarget, and stage arrivals.
  useEffect(() => {
    if (!data) return;
    const s = scene.current;
    const now = performance.now();
    const first = !loaded.current;
    const clusterColor = new Map<string, string>();
    [...data.clusters].sort((a, b) => a.id.localeCompare(b.id)).forEach((c, i) => clusterColor.set(c.id, DUST[i % DUST.length]));

    const byId = new Map<string, P>();
    let arrivals = 0;
    data.points.forEach((pt: EmbeddingPoint, i) => {
      let p = s.byId.get(pt.id);
      if (!p) {
        const fly = first ? 1 : 2.6;
        p = {
          id: pt.id,
          kind: pt.kind,
          label: pt.label,
          domain: pt.domain,
          status: pt.status,
          clusterId: pt.clusterId,
          author: pt.author,
          createdAt: pt.createdAt,
          tx: pt.x,
          ty: pt.y,
          tz: pt.z,
          x: pt.x * fly,
          y: pt.y * fly,
          z: pt.z * fly,
          born: first ? now + (i / Math.max(1, data.points.length)) * INTRO_MS : now,
          flare: !first,
          color: "",
          r: 0,
          near: null,
          sx: 0,
          sy: 0,
          k: 1,
          fog: 1,
          vis: 0,
        };
        if (!first) arrivals++;
      }
      p.label = pt.label;
      p.domain = pt.domain;
      p.status = pt.status;
      p.clusterId = pt.clusterId;
      p.author = pt.author;
      p.tx = pt.x;
      p.ty = pt.y;
      p.tz = pt.z;
      p.color =
        pt.kind === "node"
          ? pt.domain
            ? DOMAIN_TINT[pt.domain]
            : "#ededed"
          : (pt.clusterId && clusterColor.get(pt.clusterId)) || DUST_LOOSE;
      p.r = pt.kind === "node" ? NODE_R[pt.status ?? "unknown"] : 1;
      byId.set(p.id, p);
    });

    const all = [...byId.values()];
    const nodes = all.filter((p) => p.kind === "node");
    const dust = new Map<string, P[]>();
    for (const p of all) {
      if (p.kind !== "source") continue;
      // Tether to the nearest star in embedding space, not screen space, so the lines mean something.
      let best: P | null = null;
      let bd = Infinity;
      for (const n of nodes) {
        const d = (n.tx - p.tx) ** 2 + (n.ty - p.ty) ** 2 + (n.tz - p.tz) ** 2;
        if (d < bd) {
          bd = d;
          best = n;
        }
      }
      p.near = best;
      const bucket = dust.get(p.color);
      if (bucket) bucket.push(p);
      else dust.set(p.color, [p]);
    }

    scene.current = { all, byId, nodes, dust, clusters: data.clusters };
    loaded.current = true;
    setCounts({ nodes: nodes.length, sources: all.length - nodes.length, clusters: data.clusters.length });
    if (arrivals > 0) setLanded({ n: arrivals, at: Date.now() });
  }, [data]);

  useEffect(() => {
    if (!landed) return;
    const t = setTimeout(() => setLanded(null), 3200);
    return () => clearTimeout(t);
  }, [landed]);

  // The render loop. Everything it reads lives in refs, so it is set up once per mount.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!wrap || !canvas || !ctx) return;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduce = motionQuery.matches;
    const onMotion = () => (reduce = motionQuery.matches);
    motionQuery.addEventListener("change", onMotion);

    const css = getComputedStyle(wrap);
    const mono = `${css.getPropertyValue("--font-geist-mono").trim() || "ui-monospace"}, ui-monospace, monospace`;
    const sans = `${css.getPropertyValue("--font-geist").trim() || "system-ui"}, system-ui, sans-serif`;

    let w = 0;
    let h = 0;
    let dpr = 1;
    const resize = () => {
      const box = wrap.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = Math.max(1, box.width);
      h = Math.max(1, box.height);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // View state.
    let yaw = 0.6;
    let pitch = -0.32;
    let zoom = 1;
    let yawVel = 0;
    let pitchVel = 0;
    let idleUntil = 0;
    let mouse: { x: number; y: number } | null = null;
    let drag: { x: number; y: number; moved: number; t: number } | null = null;
    let hovered: P | null = null;
    const info = (p: P): Hover => ({
      id: p.id,
      kind: p.kind,
      label: p.label,
      domain: p.domain,
      status: p.status,
      author: p.author,
      createdAt: p.createdAt,
      cluster: scene.current.clusters.find((c) => c.id === p.clusterId)?.label ?? null,
    });

    const sprites = new Map<string, HTMLCanvasElement>();
    const sprite = (color: string) => {
      let c = sprites.get(color);
      if (c) return c;
      c = document.createElement("canvas");
      c.width = c.height = 64;
      const g = c.getContext("2d")!;
      const [r, gg, b] = rgb(color);
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, `rgba(${r},${gg},${b},0.95)`);
      grad.addColorStop(0.12, `rgba(${r},${gg},${b},0.55)`);
      grad.addColorStop(0.4, `rgba(${r},${gg},${b},0.12)`);
      grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      sprites.set(color, c);
      return c;
    };

    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, moved: 0, t: performance.now() };
      yawVel = pitchVel = 0;
      canvas.style.cursor = "grabbing";
    };
    const onMove = (e: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      mouse = { x: e.clientX - box.left, y: e.clientY - box.top };
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      const t = performance.now();
      const dt = Math.max(8, t - drag.t) / 1000;
      yaw += dx * 0.006;
      pitch = clamp(pitch + dy * 0.006, -1.35, 1.35);
      yawVel = (dx * 0.006) / dt;
      pitchVel = (dy * 0.006) / dt;
      drag = { x: e.clientX, y: e.clientY, moved: drag.moved + Math.abs(dx) + Math.abs(dy), t };
      idleUntil = t + 2500;
    };
    const onUp = (e: PointerEvent) => {
      if (drag && drag.moved < 5) {
        // A click (not a drag) opens the point under the cursor, or closes the card on empty sky.
        pinRef.current(hovered ? info(hovered) : null);
        if (hovered?.kind === "node") selectRef.current(hovered.id);
      }
      if (drag && performance.now() - drag.t > 80) yawVel = pitchVel = 0; // released after a pause: no fling
      drag = null;
      canvas.style.cursor = hovered ? "pointer" : "grab";
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    const onLeave = () => {
      if (!drag) mouse = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom = clamp(zoom * Math.exp(-e.deltaY * 0.0012), 0.55, 3.2);
      idleUntil = performance.now() + 2500;
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    // Only spend frames while on screen and the tab is visible.
    let onScreen = true;
    const io = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      if (onScreen) kick();
    });
    io.observe(wrap);
    const onVis = () => document.visibilityState === "visible" && kick();
    document.addEventListener("visibilitychange", onVis);

    let raf = 0;
    let last = performance.now();
    const kick = () => {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    function frame(t: number) {
      raf = 0;
      if (!onScreen || document.visibilityState !== "visible") return;
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      draw(t, dt);
      raf = requestAnimationFrame(frame);
    }

    function draw(t: number, dt: number) {
      const { all, nodes, dust, clusters, byId } = scene.current;
      const hi = hiRef.current;

      if (!drag) {
        yaw += yawVel * dt;
        pitch = clamp(pitch + pitchVel * dt, -1.35, 1.35);
        const decay = Math.exp(-dt * 3.2);
        yawVel *= decay;
        pitchVel *= decay;
        if (!reduce && t > idleUntil) yaw += AUTO_SPIN * dt;
      }

      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      const R = Math.min(w, h) * 0.42 * zoom;
      const ox = w / 2;
      const oy = h / 2;
      const ease = reduce ? 1 : 1 - Math.exp(-dt * 3.4);
      const project = (x: number, y: number, z: number, out: { sx: number; sy: number; k: number; fog: number }) => {
        const x1 = x * cy - z * sy;
        const z1 = x * sy + z * cy;
        const y1 = y * cp - z1 * sp;
        const z2 = y * sp + z1 * cp;
        // Arrivals start 2.6x out and can pass the eye; clamp so they never flip or blow up.
        const k = CAMERA / Math.max(0.5, CAMERA - z2);
        out.sx = ox + x1 * R * k;
        out.sy = oy - y1 * R * k;
        out.k = k;
        out.fog = clamp(0.32 + ((z2 + 1.7) / 3.4) * 0.68, 0.2, 1);
      };

      for (const p of all) {
        p.x += (p.tx - p.x) * ease;
        p.y += (p.ty - p.y) * ease;
        p.z += (p.tz - p.z) * ease;
        project(p.x, p.y, p.z, p);
        p.vis = reduce ? 1 : clamp((t - p.born) / FADE_MS, 0, 1);
      }

      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, w, h);
      ctx!.globalCompositeOperation = "source-over";

      // Orbital plane: a faint dotted ring in the xz-plane gives the cloud a floor and a sense of turn.
      const tmp = { sx: 0, sy: 0, k: 1, fog: 1 };
      ctx!.beginPath();
      for (let i = 0; i <= 96; i++) {
        const a = (i / 96) * Math.PI * 2;
        project(Math.cos(a) * 1.25, -1.05, Math.sin(a) * 1.25, tmp);
        if (i === 0) ctx!.moveTo(tmp.sx, tmp.sy);
        else ctx!.lineTo(tmp.sx, tmp.sy);
      }
      ctx!.setLineDash([1, 5]);
      ctx!.strokeStyle = "rgba(237,237,237,0.16)";
      ctx!.lineWidth = 1;
      ctx!.stroke();
      ctx!.setLineDash([]);

      // Tethers: one path for the quiet ones, one for anything touching a highlighted star.
      ctx!.beginPath();
      const lit = new Path2D();
      for (const p of all) {
        const n = p.near;
        if (!n || p.vis <= 0 || n.vis <= 0) continue;
        if (hi.has(n.id)) {
          lit.moveTo(p.sx, p.sy);
          lit.lineTo(n.sx, n.sy);
        } else {
          ctx!.moveTo(p.sx, p.sy);
          ctx!.lineTo(n.sx, n.sy);
        }
      }
      ctx!.strokeStyle = "rgba(237,237,237,0.1)";
      ctx!.lineWidth = 0.6;
      ctx!.stroke();
      ctx!.strokeStyle = "rgba(237,237,237,0.22)";
      ctx!.lineWidth = 0.8;
      ctx!.stroke(lit);

      ctx!.globalCompositeOperation = "lighter";

      // Dust, bucketed by color so fillStyle changes once per cluster.
      for (const [color, pts] of dust) {
        ctx!.fillStyle = color;
        for (const p of pts) {
          if (p.vis <= 0) continue;
          const s = 2.6 * p.k;
          ctx!.globalAlpha = p.fog * p.vis * 0.9;
          ctx!.fillRect(p.sx - s / 2, p.sy - s / 2, s, s);
        }
      }

      // Stars: tinted glow sprite plus a near-white core.
      const pulse = reduce ? 1 : 1 + 0.28 * Math.sin(t / 260);
      for (const p of nodes) {
        if (p.vis <= 0) continue;
        const on = hi.has(p.id);
        const g = p.r * p.k * (on ? 11 * pulse : 8.5) * (p === hovered ? 1.25 : 1);
        ctx!.globalAlpha = p.fog * p.vis * (on ? 1 : 0.85);
        ctx!.drawImage(sprite(p.color), p.sx - g / 2, p.sy - g / 2, g, g);
        ctx!.fillStyle = on ? "#ffffff" : "#f2f2f2";
        ctx!.beginPath();
        ctx!.arc(p.sx, p.sy, Math.max(1.4, p.r * p.k * 0.55), 0, Math.PI * 2);
        ctx!.fill();
      }

      // Arrivals: a ring that blooms outward and fades as the point settles.
      for (const p of all) {
        if (!p.flare) continue;
        if (reduce) {
          p.flare = false;
          continue;
        }
        const age = t - p.born;
        if (age > FLARE_MS) {
          p.flare = false;
          continue;
        }
        if (age < 0) continue;
        const f = age / FLARE_MS;
        ctx!.globalAlpha = (1 - f) * 0.9;
        ctx!.strokeStyle = p.color;
        ctx!.lineWidth = 1.2;
        ctx!.beginPath();
        ctx!.arc(p.sx, p.sy, 3 + easeOut(f) * (p.kind === "node" ? 30 : 18), 0, Math.PI * 2);
        ctx!.stroke();
        const g = (p.kind === "node" ? 26 : 14) * (1 - f);
        ctx!.globalAlpha = 1 - f;
        ctx!.drawImage(sprite(p.color), p.sx - g / 2, p.sy - g / 2, g, g);
      }

      ctx!.globalCompositeOperation = "source-over";
      ctx!.globalAlpha = 1;

      // Rings on highlighted stars, dashed when blocked (the StatusMark vocabulary).
      for (const id of hi) {
        const p = byId.get(id);
        if (!p || p.kind !== "node" || p.vis <= 0) continue;
        ctx!.strokeStyle = `rgba(237,237,237,${0.5 * p.vis})`;
        ctx!.lineWidth = 1;
        if (p.status === "blocked") ctx!.setLineDash([2, 3]);
        ctx!.beginPath();
        ctx!.arc(p.sx, p.sy, 9 * p.k * (reduce ? 1 : 0.94 + 0.06 * pulse), 0, Math.PI * 2);
        ctx!.stroke();
        ctx!.setLineDash([]);
        ctx!.font = `500 12px ${sans}`;
        ctx!.fillStyle = `rgba(237,237,237,${0.92 * p.vis})`;
        ctx!.fillText(p.label, p.sx + 13 * p.k, p.sy + 4);
      }

      // Cluster labels at their live centroids.
      if (clusters.length) {
        const acc = new Map<string, { x: number; y: number; z: number; n: number }>();
        for (const p of all) {
          if (!p.clusterId || p.vis < 0.5) continue;
          const a = acc.get(p.clusterId);
          if (a) {
            a.x += p.x;
            a.y += p.y;
            a.z += p.z;
            a.n++;
          } else acc.set(p.clusterId, { x: p.x, y: p.y, z: p.z, n: 1 });
        }
        ctx!.font = `10px ${mono}`;
        ctx!.textAlign = "center";
        const ranked = [...clusters].sort((a, b) => b.size - a.size).slice(0, 10);
        for (const c of ranked) {
          const a = acc.get(c.id);
          if (!a || a.n < 3) continue;
          project(a.x / a.n, a.y / a.n, a.z / a.n, tmp);
          const y = tmp.sy - 18 * tmp.k;
          ctx!.fillStyle = `rgba(143,143,143,${0.75 * tmp.fog})`;
          ctx!.fillText(c.label.toUpperCase(), tmp.sx, y);
          ctx!.fillStyle = `rgba(90,90,90,${0.8 * tmp.fog})`;
          ctx!.fillText(`${c.size}`, tmp.sx, y + 12);
        }
        ctx!.textAlign = "start";
      }

      // Hover: nearest point under the cursor, stars favored over dust.
      let best: P | null = null;
      if (mouse && !drag) {
        let bd = Infinity;
        for (const p of all) {
          if (p.vis < 0.5) continue;
          const reach = p.kind === "node" ? 16 : 7;
          const d = Math.hypot(p.sx - mouse.x, p.sy - mouse.y);
          if (d > reach) continue;
          const score = d - (p.kind === "node" ? 8 : 0);
          if (score < bd) {
            bd = score;
            best = p;
          }
        }
      } else if (drag) best = hovered;
      if (best !== hovered) {
        hovered = best;
        canvas!.style.cursor = drag ? "grabbing" : best ? "pointer" : "grab";
        setHover(best && info(best));
      }
      if (hovered) {
        ctx!.strokeStyle = "rgba(237,237,237,0.7)";
        ctx!.lineWidth = 1;
        ctx!.beginPath();
        ctx!.arc(hovered.sx, hovered.sy, hovered.kind === "node" ? 8 * hovered.k : 5, 0, Math.PI * 2);
        ctx!.stroke();
        const tip = tipRef.current;
        if (tip) {
          const right = hovered.sx > w - 240;
          const x = right ? hovered.sx - 14 : hovered.sx + 14;
          tip.style.transform = `translate(${x}px, ${hovered.sy - 10}px) translateX(${right ? "-100%" : "0"})`;
        }
      }
    }

    kick();
    return () => {
      cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      io.disconnect();
      motionQuery.removeEventListener("change", onMotion);
      document.removeEventListener("visibilitychange", onVis);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, []);

  const empty = data !== null && data.points.length === 0;
  const presentDomains = useMemo(
    () => DOMAINS.filter((d) => data?.points.some((p) => p.kind === "node" && p.domain === d)),
    [data],
  );

  return (
    <div
      ref={wrapRef}
      className={cn(
        "relative isolate h-full min-h-[320px] w-full overflow-hidden rounded-2xl bg-[radial-gradient(ellipse_at_50%_45%,#0e0e0e_0%,#060606_55%,#000_100%)] select-none",
        className,
      )}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 touch-none"
        style={{ cursor: "grab" }}
        role="img"
        aria-label={`Embedding constellation: ${counts.nodes} projects and ${counts.sources} documents in ${counts.clusters} clusters`}
      />

      <div className="pointer-events-none absolute top-4 left-5 font-mono text-[11px] tracking-wide text-faint uppercase">
        <span className="text-muted">Embedding space</span>
        {data && data.points.length > 0 && (
          <span className="block tabular-nums">
            {counts.nodes} stars · {counts.sources} captures · {counts.clusters} clusters
          </span>
        )}
      </div>

      <AnimatePresence>
        {landed && (
          <motion.div
            key={landed.at}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            className="pointer-events-none absolute top-4 right-5 flex items-center gap-2 rounded-full border border-line-strong bg-bg/70 px-2.5 py-1 font-mono text-[11px] text-ink backdrop-blur"
          >
            <span className="size-1.5 rounded-full bg-ink shadow-[0_0_8px_#ededed]" />+{landed.n} landed
          </motion.div>
        )}
      </AnimatePresence>

      {presentDomains.length > 0 && (
        <ul className="pointer-events-none absolute bottom-4 left-5 flex flex-wrap gap-x-3.5 gap-y-1 text-[12px] text-muted">
          {presentDomains.map((d) => (
            <li key={d} className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full" style={{ backgroundColor: DOMAIN_TINT[d], boxShadow: `0 0 6px ${DOMAIN_TINT[d]}` }} />
              {DOMAIN_LABEL[d]}
            </li>
          ))}
          <li className="flex items-center gap-1.5 text-faint">
            <span className="size-1 bg-faint" />
            Sources
          </li>
        </ul>
      )}
      {data && data.points.length > 0 && (
        <p className="pointer-events-none absolute right-5 bottom-4 hidden font-mono text-[10.5px] tracking-wide text-faint uppercase sm:block">
          Drag to orbit · scroll to zoom
        </p>
      )}

      {(empty || !data) && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-center">
          <p className={cn("font-mono text-[11px] tracking-wide text-faint uppercase", !empty && !error && "animate-pulse")}>
            {empty ? "Nothing captured yet" : error ? "Reconnecting…" : "Charting…"}
          </p>
        </div>
      )}

      <AnimatePresence>
        {pinned && (
          <PointCard key={pinned.id} point={pinned} orgId={orgId} graph={graph ?? null} onClose={() => setPinned(null)} />
        )}
      </AnimatePresence>

      <div
        ref={tipRef}
        className={cn(
          "pointer-events-none absolute top-0 left-0 z-10 w-max max-w-[240px] rounded-lg border border-line-strong bg-raised/95 px-3 py-2 text-[13px] shadow-[0_12px_32px_rgba(0,0,0,0.5)] backdrop-blur transition-opacity duration-150",
          hover && hover.id !== pinned?.id ? "opacity-100" : "opacity-0",
        )}
      >
        {hover && (
          <>
            <p className="flex items-center gap-1.5 font-mono text-[10.5px] tracking-wide text-faint uppercase">
              {hover.kind === "node" && hover.domain && (
                <span className="size-1.5 rounded-full" style={{ backgroundColor: DOMAIN_TINT[hover.domain] }} />
              )}
              {hover.kind === "node"
                ? [hover.domain && DOMAIN_LABEL[hover.domain], hover.status && STATUS_LABEL[hover.status]].filter(Boolean).join(" · ")
                : ["Document", hover.cluster].filter(Boolean).join(" · ")}
            </p>
            <p className="mt-0.5 leading-snug font-medium">{hover.label}</p>
            {(hover.author || hover.createdAt) && (
              <p className="mt-0.5 text-[12px] text-muted">
                {[hover.author, hover.createdAt && since(hover.createdAt)].filter(Boolean).join(" · ")}
              </p>
            )}
            <p className="mt-1 font-mono text-[10.5px] text-faint uppercase">Click to open</p>
          </>
        )}
      </div>
    </div>
  );
}
