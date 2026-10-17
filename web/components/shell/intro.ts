"use client";

// The first-visit intro: after the first question, a scroll-scrubbed reveal from the hero to the map.
// Progress drives CSS variables on the stage; a tween plays it on its own, and the wheel or keys can take over.

import type { MapCamera } from "@/components/map/StarMap";
import { type CSSProperties, type RefObject, useEffect, useRef } from "react";

export type Phase = "hero" | "entering" | "app";

export const HERO_VARS = {
  "--title": 1,
  "--spiral": 1,
  "--chat": 0,
  "--reveal-rings": 0,
  "--reveal-core": 0,
  "--reveal-hubs": 0,
  "--reveal-labels": 0,
  "--reveal-stars": 0,
  "--reply": 0,
  "--header": 0,
  "--progress": 0,
} as CSSProperties;

const APP_INLINE: Record<string, string> = {
  "--title": "0",
  "--spiral": "0",
  "--chat": "1",
  "--reveal-rings": "1",
  "--reveal-core": "1",
  "--reveal-hubs": "1",
  "--reveal-labels": "1",
  "--reveal-stars": "1",
  "--reply": "1",
  "--header": "1",
  "--progress": "1",
};

export const APP_VARS = {
  "--title": 0,
  "--spiral": 0,
  "--chat": 1,
  "--reveal-rings": 1,
  "--reveal-core": 1,
  "--reveal-hubs": 1,
  "--reveal-labels": 1,
  "--reveal-stars": 1,
  "--reply": 1,
  "--header": 1,
  "--progress": 1,
} as CSSProperties;

export const BEATS = [
  {
    in: 0.3,
    out: 0.5,
    side: "side-left",
    title: "Four kinds of work.",
    body: "Engineering, marketing, sales and ops each get a hub.",
  },
  {
    in: 0.56,
    out: 0.76,
    side: "side-right",
    title: "Every project, one line from the center.",
    body: "Solid is moving. Dashed is blocked. Grey is done.",
  },
];

const SCROLL_SECONDS = 6.4;
const RESUME_AFTER_MS = 1200;

function ramp(progress: number, start: number, end: number) {
  return Math.min(1, Math.max(0, (progress - start) / (end - start)));
}

function easeOut(value: number) {
  return 1 - Math.pow(1 - value, 3);
}

export function useIntroScroll({
  phase,
  sectionRef,
  stageRef,
  mapRef,
  highlightRef,
  onFinish,
}: {
  phase: Phase;
  sectionRef: RefObject<HTMLDivElement | null>;
  stageRef: RefObject<HTMLDivElement | null>;
  mapRef: RefObject<MapCamera | null>;
  highlightRef: RefObject<string[]>;
  onFinish: () => void;
}) {
  const onFinishRef = useRef(onFinish);
  useEffect(() => {
    onFinishRef.current = onFinish;
  });

  useEffect(() => {
    if (phase !== "entering") return;
    const section = sectionRef.current;
    const stage = stageRef.current;
    if (!section || !stage) return;

    const overlays = Array.from(stage.querySelectorAll<HTMLElement>("[data-in]"));
    let progress = 0;
    let frame = 0;
    let cancelled = false;
    let finished = false;
    let stopTween: (() => void) | null = null;
    let startTween: (() => void) | null = null;
    let killTrigger: (() => void) | null = null;
    let idle = 0;
    let writingScroll = false;

    const set = (name: string, value: number) => stage.style.setProperty(name, value.toFixed(3));
    const stampMap = () => {
      for (const [name, value] of Object.entries(APP_INLINE)) stage.style.setProperty(name, value);
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      stampMap();
      onFinishRef.current();
    };
    const apply = () => {
      frame = 0;
      if (finished) return;
      const p = progress;
      set("--progress", p);
      set("--title", 1 - easeOut(ramp(p, 0, 0.14)));
      set("--spiral", 1 - easeOut(ramp(p, 0.08, 0.34)));
      set("--chat", easeOut(ramp(p, 0.12, 0.42)));
      set("--reveal-rings", easeOut(ramp(p, 0.2, 0.4)));
      set("--reveal-core", easeOut(ramp(p, 0.28, 0.46)));
      set("--reveal-hubs", easeOut(ramp(p, 0.36, 0.56)));
      set("--reveal-labels", easeOut(ramp(p, 0.46, 0.64)));
      set("--reveal-stars", easeOut(ramp(p, 0.52, 0.8)));
      set("--reply", easeOut(ramp(p, 0.72, 0.94)));
      set("--header", easeOut(ramp(p, 0.84, 1)));
      mapRef.current?.lookAt(highlightRef.current, easeOut(ramp(p, 0.64, 1)));
      for (const overlay of overlays) {
        const visible = p >= Number(overlay.dataset.in) && p <= Number(overlay.dataset.out);
        overlay.classList.toggle("visible", visible);
      }
      if (p >= 0.999) finish();
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const interrupt = (event: Event) => {
      if (event instanceof KeyboardEvent && ![" ", "PageDown", "PageUp", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        return;
      }
      stopTween?.();
      window.clearTimeout(idle);
      idle = window.setTimeout(() => startTween?.(), RESUME_AFTER_MS);
    };

    const root = document.documentElement;
    root.style.scrollbarWidth = "none";
    window.scrollTo(0, 0);
    (async () => {
      const [{ gsap }, { ScrollTrigger }] = await Promise.all([import("gsap"), import("gsap/ScrollTrigger")]);
      if (cancelled) return;
      gsap.registerPlugin(ScrollTrigger);
      const trigger = ScrollTrigger.create({
        trigger: section,
        start: "top top",
        end: "bottom bottom",
        onUpdate: (self) => {
          if (finished) return;
          if (progress > 0.72 && self.progress < 0.2) {
            finish();
            return;
          }
          progress = self.progress;
          schedule();
        },
      });
      killTrigger = () => trigger.kill();
      startTween = () => {
        stopTween?.();
        const end = section.offsetHeight - window.innerHeight;
        const scroller = { y: window.scrollY };
        const remaining = Math.max(0, (end - scroller.y) / end);
        const tween = gsap.to(scroller, {
          y: end,
          duration: Math.max(0.6, SCROLL_SECONDS * remaining),
          ease: remaining > 0.9 ? "power1.inOut" : "power2.out",
          onUpdate: () => {
            writingScroll = true;
            window.scrollTo(0, scroller.y);
            writingScroll = false;
          },
        });
        stopTween = () => tween.kill();
      };
      startTween();
    })();

    let lastY = window.scrollY;
    let userScrolling = false;
    const noteUserScroll = () => {
      userScrolling = true;
    };
    const keepPlace = () => {
      const y = window.scrollY;
      const range = section.offsetHeight - window.innerHeight;
      if (!writingScroll && !userScrolling && lastY - y > range * 0.35 && lastY > range * 0.5) {
        writingScroll = true;
        window.scrollTo(0, lastY);
        writingScroll = false;
        return;
      }
      lastY = window.scrollY;
      userScrolling = false;
    };
    window.addEventListener("wheel", noteUserScroll, { passive: true });
    window.addEventListener("touchstart", noteUserScroll, { passive: true });
    window.addEventListener("wheel", interrupt, { passive: true });
    window.addEventListener("touchstart", interrupt, { passive: true });
    window.addEventListener("keydown", interrupt);
    window.addEventListener("scroll", keepPlace, { passive: true });
    return () => {
      finished = true;
      cancelled = true;
      cancelAnimationFrame(frame);
      root.style.scrollbarWidth = "";
      window.clearTimeout(idle);
      stopTween?.();
      killTrigger?.();
      stampMap();
      window.removeEventListener("wheel", noteUserScroll);
      window.removeEventListener("touchstart", noteUserScroll);
      window.removeEventListener("wheel", interrupt);
      window.removeEventListener("touchstart", interrupt);
      window.removeEventListener("keydown", interrupt);
      window.removeEventListener("scroll", keepPlace);
    };
  }, [phase, sectionRef, stageRef, mapRef, highlightRef]);
}
