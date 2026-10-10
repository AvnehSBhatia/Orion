"use client";

import { ContextList } from "@/components/ContextList";
import { Logo, StarDashboard } from "@/components/StarDashboard";
import { CompactMap, type MapCamera, MapLegend, StarMap } from "@/components/StarMap";
import { BlackHole, type BlackHoleHandle } from "@/components/ui/black-hole";
import RandomLetterSwapNav from "@/components/ui/m-random-letter-swap-1";
import RuixenMoonChat, { type QuickActionItem } from "@/components/ui/ruixen-moon-chat";
import { answer, type Message, STARS, SUGGESTIONS } from "@/lib/stars";
import { cn } from "@/lib/utils";
import { ArrowRight, CircleAlert, Megaphone, TrendingUp, X } from "lucide-react";
import { type CSSProperties, type KeyboardEvent, type MouseEvent, useEffect, useLayoutEffect, useRef, useState } from "react";

type Phase = "hero" | "entering" | "app";
type View = "map" | "context" | "blocked";

const HERO_VARS = {
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

const APP_VARS = {
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

const BEATS = [
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

const ACTIVE: Record<View, string> = {
  map: "[&_[data-label='Map']]:text-foreground",
  context: "[&_[data-label='Context']]:text-foreground",
  blocked: "[&_[data-label='Blocked']]:text-foreground",
};

const ACTIONS: QuickActionItem[] = [
  { icon: Megaphone, label: "What sales can say", prompt: SUGGESTIONS[0] },
  { icon: CircleAlert, label: "What is blocked", prompt: SUGGESTIONS[1] },
  { icon: TrendingUp, label: "What changed today", prompt: SUGGESTIONS[2] },
];

const SCROLL_SECONDS = 6.4;
const RESUME_AFTER_MS = 1200;

function ramp(progress: number, start: number, end: number) {
  return Math.min(1, Math.max(0, (progress - start) / (end - start)));
}

function easeOut(value: number) {
  return 1 - Math.pow(1 - value, 3);
}

export function AppShell() {
  const [phase, setPhase] = useState<Phase>("hero");
  const [view, setView] = useState<View>("map");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightIds, setHighlightIds] = useState<string[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [lastId, setLastId] = useState<string | null>(null);
  const [replyOpen, setReplyOpen] = useState(true);
  const sectionRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const holeRef = useRef<BlackHoleHandle>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapCamera>(null);
  const highlightRef = useRef<string[]>([]);
  const pendingFly = useRef<string[] | null>(null);

  useEffect(() => {
    const dock = dockRef.current;
    const stage = stageRef.current;
    if (!dock || !stage) return;
    const observer = new ResizeObserver(() => stage.style.setProperty("--dock", `${dock.offsetHeight}px`));
    observer.observe(dock);
    return () => observer.disconnect();
  }, [selectedId]);

  const ask = (text: string) => {
    const result = answer(text);
    setReplyOpen(true);
    setMessages((current) => [...current, { role: "user", text }, { role: "assistant", text: result.reply }]);
    const ids = result.highlightIds ?? [];
    highlightRef.current = ids;
    setHighlightIds(ids);
    setLastId(result.id ?? null);
    return result;
  };

  const sendFromMap = (text: string) => {
    const result = ask(text);
    const ids = result.highlightIds ?? [];
    if (phase === "hero") {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      setPhase(reduce ? "app" : "entering");
      return;
    }
    if (view !== "map") {
      pendingFly.current = ids;
      setSelectedId(null);
      setView("map");
      return;
    }
    mapRef.current?.flyTo(ids);
  };

  const sendFromDetail = (text: string) => {
    const result = ask(text);
    pendingFly.current = result.highlightIds ?? [];
    setSelectedId(null);
    setView("map");
  };

  const navigate = (next: View) => {
    setSelectedId(null);
    setView(next);
  };

  const onNav = (event: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>) => {
    if ("key" in event && event.key !== "Enter" && event.key !== " ") return;
    const label = (event.target as HTMLElement).closest("[data-label]")?.getAttribute("data-label");
    if (!label) return;
    event.preventDefault();
    if (label === "Ask") composerRef.current?.focus();
    else navigate(label.toLowerCase() as View);
  };

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
      setPhase("app");
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
  }, [phase]);

  useEffect(() => {
    if (phase === "app") window.scrollTo(0, 0);
  }, [phase]);

  useLayoutEffect(() => {
    if (phase !== "app" || selectedId || view !== "map") return;
    const ids = pendingFly.current;
    if (ids) {
      pendingFly.current = null;
      mapRef.current?.flyTo(ids);
      return;
    }
    mapRef.current?.lookAt(highlightRef.current, 1);
  }, [phase, selectedId, view]);

  const selected = STARS.find((star) => star.id === selectedId);
  if (phase === "app" && selected) {
    return (
      <StarDashboard
        star={selected}
        messages={messages}
        onSend={sendFromDetail}
        onAnswer={(text, reply) => {
          setReplyOpen(true);
          setMessages((current) => [...current, { role: "user", text }, { role: "assistant", text: reply }]);
        }}
        onSelect={setSelectedId}
        onNavigate={navigate}
      />
    );
  }

  const question = messages.at(-2)?.text;
  const reply = messages.at(-1)?.text;
  const lastStar = STARS.find((star) => star.id === lastId);
  const listed =
    view === "blocked"
      ? STARS.filter((star) => star.status === "blocked")
      : [...STARS].sort((a, b) => Number(a.status === "done") - Number(b.status === "done"));

  return (
    <div ref={sectionRef} className={cn("relative", phase === "entering" ? "h-[460vh]" : "h-dvh")}>
      <div
        ref={stageRef}
        style={phase === "app" ? APP_VARS : HERO_VARS}
        className={cn(
          "h-dvh overflow-hidden bg-bg text-ink",
          phase === "entering" ? "fixed inset-0" : "sticky top-0",
        )}
      >
        {phase !== "app" && (
          <div
            className="absolute inset-0 origin-bottom"
            style={{
              opacity: "var(--spiral)",
              transform: "translateY(calc((1 - var(--spiral)) * 8%)) scale(calc(0.86 + 0.14 * var(--spiral)))",
            }}
          >
            <BlackHole ref={holeRef} />
          </div>
        )}
        {phase === "entering" && (
          <div
            className="pointer-events-none absolute inset-x-0 top-0 z-40 h-px bg-white/80"
            style={{ width: "calc(var(--progress) * 100%)" }}
          />
        )}

        <header
          className="absolute inset-x-0 top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-line bg-bg px-4 md:px-6"
          style={{ opacity: "var(--header)" }}
          inert={phase !== "app"}
        >
          <span className="flex items-center gap-2.5">
            <Logo />
            <span className="hidden text-[14px] font-semibold tracking-[-0.01em] sm:inline">Orion</span>
          </span>
          <div
            onClick={onNav}
            onKeyDown={onNav}
            className={cn("[&>div]:min-h-0 [&>div]:px-0 max-sm:[&_nav]:gap-5", ACTIVE[view])}
          >
            <RandomLetterSwapNav />
          </div>
          <span className="hidden font-mono text-[12px] tracking-wide text-faint uppercase md:inline">
            {STARS.length} projects
          </span>
        </header>

        <div
          className="absolute inset-x-0 top-14"
          style={{ bottom: "calc(var(--dock, 200px) + 32px)" }}
          inert={phase !== "app"}
        >
          {view === "map" ? (
            <div className="relative h-full px-4 pt-4">
              <div
                className="absolute top-5 left-6 z-10 hidden md:block"
                style={{ opacity: "var(--header)" }}
              >
                <p className="text-[14px] font-medium">Company map</p>
                <p className="mt-0.5 max-w-56 text-[13px] text-faint">
                  {highlightIds.length
                    ? STARS.filter((star) => highlightIds.includes(star.id))
                        .map((star) => star.label)
                        .join(", ")
                    : "Click a project for details"}
                </p>
                <div className="mt-4">
                  <MapLegend />
                </div>
              </div>
              <div className="h-full max-sm:hidden">
                <StarMap ref={mapRef} highlightIds={highlightIds} onSelect={setSelectedId} />
              </div>
              <div className="h-full sm:hidden">
                <CompactMap highlightIds={highlightIds} onSelect={setSelectedId} />
              </div>
            </div>
          ) : (
            <ContextList
              title={view === "blocked" ? "Blocked" : "Context"}
              description={
                view === "blocked" ? "Work that is waiting on something else." : "Everything in motion across the company."
              }
              stars={listed}
              onSelect={setSelectedId}
            />
          )}
        </div>

        {phase === "entering" &&
          BEATS.map((beat) => (
            <div
              key={beat.title}
              data-in={beat.in}
              data-out={beat.out}
              className={cn("scrub-overlay pointer-events-none z-10 hidden md:block", beat.side)}
            >
              <h2 className="text-[30px] leading-[1.1] font-semibold tracking-[-0.035em]">{beat.title}</h2>
              <p className="mt-2 text-[15px] text-muted">{beat.body}</p>
            </div>
          ))}

        <div
          className="pointer-events-none absolute inset-x-0 z-10 px-6 text-center"
          style={{
            bottom: "calc(50% + 196px)",
            opacity: "var(--title)",
            filter: "blur(calc((1 - var(--title)) * 12px))",
            transform: "translateY(calc((1 - var(--title)) * -28px))",
          }}
        >
          <h1 className="orion-wordmark font-display text-[clamp(88px,15vw,168px)] leading-[0.84] font-normal tracking-[-0.035em]">
            Orion
          </h1>
          <p className="orion-wordmark mx-auto mt-5 max-w-md text-[15px] leading-relaxed tracking-[0.01em] text-balance text-muted [animation-delay:180ms]">
            Ask what your team is working on. The map shows the rest.
          </p>
        </div>

        <div
          ref={dockRef}
          className="absolute left-1/2 z-30 w-[min(560px,calc(100%-32px))]"
          style={{
            bottom: "calc((1 - var(--chat)) * (50% - 28px) + 20px)",
            transform: "translateX(-50%) scale(calc(0.97 + 0.03 * var(--chat)))",
          }}
        >
          {reply && replyOpen && phase !== "hero" && (
            <div
              className="mb-3 flex items-end gap-4 rounded-2xl border border-line bg-panel px-4 py-3"
              style={{ opacity: "var(--reply)" }}
              aria-live="polite"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-[13px] text-faint">{question}</p>
                  <button
                    type="button"
                    aria-label="Close answer"
                    onClick={() => setReplyOpen(false)}
                    className="shrink-0 rounded-full p-1 text-faint hover:text-ink"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
                <p className="mt-0.5 text-[14px] leading-snug">{reply}</p>
              </div>
              {lastStar && (
                <button
                  type="button"
                  onClick={() => setSelectedId(lastStar.id)}
                  aria-label={`Open ${lastStar.label}`}
                  className="flex shrink-0 items-center gap-1.5 rounded-full border border-line-strong px-3 py-1 text-[13px] text-muted transition-colors hover:border-[#4a4a4a] hover:text-ink"
                >
                  Open
                  <span className="hidden sm:inline">{lastStar.label}</span>
                  <ArrowRight className="size-3.5" />
                </button>
              )}
            </div>
          )}
          <RuixenMoonChat
            ref={composerRef}
            onSend={sendFromMap}
            onType={(delta) => {
              if (!delta) return;
              const step = Math.min(Math.abs(delta), 4);
              holeRef.current?.kick((delta > 0 ? 0.7 : -0.7) * step);
            }}
            autoFocus
            actions={phase === "hero" ? ACTIONS : undefined}
            placeholder={phase === "hero" ? "Ask what your team is working on" : "Ask a follow-up"}
          />
        </div>
      </div>
    </div>
  );
}
