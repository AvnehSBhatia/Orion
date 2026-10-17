"use client";

// Demo mode for the live pitch, built only when NEXT_PUBLIC_ORION_DEMO=true (see next.config.ts). `?demo=1` turns it on (remembered for the tab), `?demo=0` turns it off.
// When it is off, nothing here does anything: useDemo().on is false and the key handler never attaches.

import { DEMO_STEPS, type DemoStep, type DemoView } from "./script";
import { type RefObject, useEffect, useRef, useSyncExternalStore } from "react";

const KEY = "orion.demo";

type State = { on: boolean; index: number; hidden: boolean };

const OFF: State = { on: false, index: 0, hidden: false };
let state: State = OFF;
let started = false;
const listeners = new Set<() => void>();

function readOn(): boolean {
  let on = false;
  try {
    on = window.sessionStorage.getItem(KEY) === "1";
  } catch {
    // Blocked storage: only the URL decides.
  }
  const param = new URLSearchParams(window.location.search).get("demo");
  if (param === "1" || param === "0") {
    on = param === "1";
    try {
      if (on) window.sessionStorage.setItem(KEY, "1");
      else window.sessionStorage.removeItem(KEY);
    } catch {
      // Not remembered across reloads; the URL still works.
    }
  }
  return on;
}

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  if (!started && typeof window !== "undefined") {
    started = true;
    if (readOn()) set({ on: true });
  }
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const snapshot = () => state;
const serverSnapshot = () => OFF;

export function useDemo() {
  const s = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const step: DemoStep | null = s.on ? DEMO_STEPS[s.index] : null;
  return { on: s.on, step, index: s.index, hidden: s.hidden };
}

/** Called by the app whenever a message is sent, so Tab knows the step's prompt went out and moves to the next one. */
let sentHook: ((text: string) => void) | null = null;
export function noteDemoSent(text: string) {
  sentHook?.(text);
}

// ---- Plain-English hints for the dashboard cards -------------------------------------------

const WIDGET_HINT: Record<string, string> = {
  kpi: "Live count from the company map.",
  status_breakdown: "How many projects are on track, at risk, blocked or done.",
  domain_breakdown: "Projects split by team: engineering, sales, marketing, ops.",
  node_list: "Projects that match this card. Click one to see where it came from.",
  activity: "Every capture from the team, as it happens.",
  constellation: "Each dot is a page or commit. Similar work clusters together.",
  map: "The company map: teams in the middle, projects around them.",
  gaps: "Things Orion noticed are missing, like an owner or a next step.",
  people: "Who is contributing right now.",
  note: "A note Orion wrote for you.",
};

const CARD_HINT: Record<string, string> = {
  node: "One project Orion tracks. Click to see the pages and commits behind it.",
  person: "One teammate and how much they have sent Orion lately.",
  cluster: "A topic: related work grouped by meaning, across teams.",
  change: "A status change Orion read from a capture. Click to open it.",
};

export function cardHint(kind: string, widgetKind?: string): string | null {
  if (kind === "widget") return (widgetKind && WIDGET_HINT[widgetKind]) || null;
  return CARD_HINT[kind] ?? null;
}

const SECTION_HINT: Record<string, string> = {
  Dependencies: "What waits on what. When one project slips, everything after it is at risk.",
  "Who feeds what": "Each row is a person. Each dot is something they captured in the last day, on the project it updated.",
  Topics: "Related work grouped by meaning, no matter which team it came from.",
};

export function sectionHint(title: string): string | null {
  return SECTION_HINT[title] ?? null;
}

// ---- Keys ------------------------------------------------------------------------------------

export type ComposerControl = { setText: (text: string) => void };

const pause = (min: number, max: number) => min + Math.random() * (max - min);

/** How long to wait after typing `ch`, given the next character: like a person, not a metronome. */
function delayAfter(ch: string, next: string | undefined) {
  let ms = pause(28, 75);
  if (ch === ",") ms += pause(110, 200);
  else if (ch === "." || ch === "?" || ch === "!") ms += pause(180, 300);
  else if (ch === " " && next && Math.random() < 0.12) ms += pause(150, 250);
  return ms;
}

const viewerOpen = () => !!document.querySelector('[role="dialog"]');

/**
 * Tab types the step's prompt, Right/Left move between steps, Shift+H hides the caption.
 * Only attaches in demo mode; Enter still sends through the composer as usual.
 */
export function useDemoKeys({
  phase,
  composer,
  control,
  navigate,
  onStep,
  onSent,
  onAdvance,
}: {
  phase: "hero" | "entering" | "app";
  composer: RefObject<HTMLTextAreaElement | null>;
  control: RefObject<ComposerControl | null>;
  navigate: (view: Exclude<DemoView, "hero">) => void;
  onStep?: (step: DemoStep) => void;
  /** The step's prompt went out: the app has moved to the step's window. */
  onSent?: (step: DemoStep) => void;
  /** Tab is moving on to the next step: close anything step-specific (an open project). */
  onAdvance?: () => void;
}) {
  const demo = useDemo();
  const live = useRef({ phase, navigate, onStep, onSent, onAdvance, index: demo.index });
  useEffect(() => {
    live.current = { phase, navigate, onStep, onSent, onAdvance, index: demo.index };
  });
  const typing = useRef<{ text: string; timer: number } | null>(null);
  const used = useRef(0);

  useEffect(() => {
    if (!demo.on) return;
    const stop = () => {
      if (typing.current) window.clearTimeout(typing.current.timer);
      typing.current = null;
    };
    sentHook = (text) => {
      stop();
      const step = DEMO_STEPS[live.current.index];
      if (step.prompts[used.current] !== text.trim()) return;
      used.current += 1;
      // Hands off: the app goes to the step's window by itself once its prompt is sent.
      live.current.navigate(step.view);
      live.current.onStep?.(step);
      live.current.onSent?.(step);
    };

    const typeOut = (text: string) => {
      composer.current?.focus({ preventScroll: true });
      control.current?.setText("");
      let at = 0;
      const tick = () => {
        at += 1;
        if (at === 1) composer.current?.focus({ preventScroll: true });
        control.current?.setText(text.slice(0, at));
        if (at >= text.length) {
          typing.current = null;
          return;
        }
        if (typing.current) typing.current.timer = window.setTimeout(tick, delayAfter(text[at - 1], text[at]));
      };
      typing.current = { text, timer: window.setTimeout(tick, pause(120, 220)) };
    };

    const go = (delta: number) => {
      const next = Math.max(0, Math.min(DEMO_STEPS.length - 1, live.current.index + delta));
      if (next === live.current.index) return;
      stop();
      used.current = 0;
      control.current?.setText("");
      live.current.index = next;
      set({ index: next });
      const step = DEMO_STEPS[next];
      live.current.navigate(step.view);
      live.current.onStep?.(step);
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (viewerOpen()) return;
      const box = composer.current;
      const target = event.target as HTMLElement | null;
      const inComposer = !!box && target === box;
      const editingElsewhere =
        !inComposer && !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      const text = box?.value ?? "";

      if (event.key === "Tab" && !event.shiftKey) {
        if (editingElsewhere) return;
        event.preventDefault();
        if (typing.current) {
          // Second Tab mid-sentence: finish it now.
          const full = typing.current.text;
          stop();
          control.current?.setText(full);
          box?.focus({ preventScroll: true });
          return;
        }
        let prompt = DEMO_STEPS[live.current.index].prompts[used.current];
        // This step's prompt already went out: Tab moves the caption on and types the next step's prompt.
        if (!prompt && live.current.index < DEMO_STEPS.length - 1 && text.length === 0) {
          const next = live.current.index + 1;
          used.current = 0;
          live.current.index = next;
          set({ index: next });
          live.current.onAdvance?.();
          prompt = DEMO_STEPS[next].prompts[0];
        }
        if (!prompt || text === prompt) return;
        typeOut(prompt);
        return;
      }

      if ((event.key === "H" || event.key === "h") && event.shiftKey) {
        if (editingElsewhere || text.length > 0) return;
        event.preventDefault();
        set({ hidden: !state.hidden });
        return;
      }

      if ((event.key === "ArrowRight" || event.key === "ArrowLeft") && !event.shiftKey) {
        if (editingElsewhere || typing.current) return;
        if (box && (box.value.length > 0 || box.selectionStart !== box.value.length)) return;
        if (live.current.phase !== "app") return;
        event.preventDefault();
        go(event.key === "ArrowRight" ? 1 : -1);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      sentHook = null;
      stop();
    };
  }, [demo.on, composer, control]);
}
