"use client";

import { ActionPills, ReplyText } from "@/components/ChatPanel";
import { SourceViewer } from "@/components/SourceViewer";
import { openSource } from "@/lib/viewer";
import { ContextList } from "@/components/ContextList";
import { DemoCaption } from "@/components/DemoCaption";
import { DynamicDashboard } from "@/components/dashboard/DynamicDashboard";
import { Logo, StarDashboard } from "@/components/StarDashboard";
import { CompactMap, type MapCamera, MapLegend, StarMap } from "@/components/StarMap";
import { BlackHole, type BlackHoleHandle } from "@/components/ui/black-hole";
import RandomLetterSwapNav from "@/components/ui/m-random-letter-swap-1";
import RuixenMoonChat, { type QuickActionItem } from "@/components/ui/ruixen-moon-chat";
import {
  ago,
  captureLine,
  DEFAULT_USER,
  defaultOrg,
  defaultUser,
  fallbackDashboard,
  promptsForRole,
  readStored,
  toStars,
  useNow,
  writeStored,
} from "@/lib/live";
import {
  type ActivityResponse,
  type ChatTurn,
  type DashboardSpec,
  type GraphResponse,
  orion,
  type OrgSummary,
  type User,
  usePoll,
  type ViewCommand,
} from "@/lib/orion";
import { type ComposerControl, noteDemoSent, useDemo, useDemoKeys } from "@/lib/demo";
import { answer, DOMAIN_LABEL, type Domain, type Message, STARS } from "@/lib/stars";
import { cn } from "@/lib/utils";
import { Check, ChevronDown, CircleAlert, Megaphone, RotateCcw, Sparkles, TrendingUp, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Phase = "hero" | "entering" | "app";
type View = "home" | "map" | "context" | "blocked";

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

const NAV = ["Home", "Map", "Context", "Blocked", "Ask"];

const ACTIVE: Record<View, string> = {
  home: "[&_[data-label='Home']]:text-foreground",
  map: "[&_[data-label='Map']]:text-foreground",
  context: "[&_[data-label='Context']]:text-foreground",
  blocked: "[&_[data-label='Blocked']]:text-foreground",
};

const ACTION_ICONS = [TrendingUp, CircleAlert, Megaphone];

const ORG_KEY = "orion.org";
const userKey = (orgId: string) => `orion.user.${orgId}`;

type Toast = { id: number; text: string; kind: "info" | "dashboard" };

/** Polled data tagged with the key it was loaded for, so a switch of org or person never shows the previous one's data. */
type Tagged<T> = { key: string; value: T };

function newer(a: Tagged<DashboardSpec> | null, b: Tagged<DashboardSpec> | null, key: string | null) {
  const live = [a, b].filter((item): item is Tagged<DashboardSpec> => !!item && item.key === key);
  return live.sort((x, y) => Date.parse(y.value.updatedAt) - Date.parse(x.value.updatedAt))[0] ?? null;
}

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
  const [view, setView] = useState<View>("home");
  const [domainFilter, setDomainFilter] = useState<Domain | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightIds, setHighlightIds] = useState<string[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [lastId, setLastId] = useState<string | null>(null);
  const [replyOpen, setReplyOpen] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [override, setOverride] = useState<Tagged<DashboardSpec> | null>(null);
  const [resetting, setResetting] = useState(false);
  const [reshaping, setReshaping] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const composerControl = useRef<ComposerControl>(null);
  const demo = useDemo();
  const holeRef = useRef<BlackHoleHandle>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapCamera>(null);
  const highlightRef = useRef<string[]>([]);
  const phaseRef = useRef(phase);
  const selectedRef = useRef(selectedId);
  const orgRef = useRef(orgId);
  const userRef = useRef(userId);
  const knownOrgs = useRef<Set<string> | null>(null);
  // The org we are on when it has no captures yet (so a newly created org may take over), and whether
  // the person was picked for us rather than chosen (so the founder can take over once they join).
  const idleOrg = useRef<string | null>(null);
  const autoUser = useRef(true);

  useEffect(() => {
    phaseRef.current = phase;
    selectedRef.current = selectedId;
    orgRef.current = orgId;
    userRef.current = userId;
  });

  // ---- Live data -------------------------------------------------------------------

  const notify = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current.slice(-2), { id, text, kind }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), kind === "dashboard" ? 6000 : 4500);
  }, []);

  // Org and person are picked as each poll lands (not in an effect), so the first paint after data is already right.
  const pickOrg = (orgs: OrgSummary[]) => {
    if (orgs.length === 0) return;
    const ids = new Set(orgs.map((org) => org.id));
    const seen = knownOrgs.current;
    knownOrgs.current = ids;
    const current = orgRef.current;
    if (current && ids.has(current)) {
      // The swarm creates its org after the page is open; follow it there unless we are watching an org with real activity.
      const idle = current === "demo" || idleOrg.current === current;
      const fresh = idle && seen ? orgs.find((org) => org.id !== "demo" && !seen.has(org.id)) : undefined;
      if (fresh) {
        orgRef.current = fresh.id;
        userRef.current = null;
        autoUser.current = true;
        setOrgId(fresh.id);
        setUserId(null);
        writeStored(ORG_KEY, fresh.id);
        notify(`${fresh.name} just came online. Switched to it.`);
      }
      return;
    }
    const stored = readStored(ORG_KEY);
    const next = stored && ids.has(stored) ? stored : (defaultOrg(orgs)?.id ?? null);
    orgRef.current = next;
    setOrgId(next);
  };

  const orgsPoll = usePoll(
    "orgs",
    async () => {
      const response = await orion.orgs();
      pickOrg(response.orgs);
      return response;
    },
    5000,
  );
  const orgs = useMemo(() => orgsPoll.data?.orgs ?? [], [orgsPoll.data]);
  const offline = !orgsPoll.data && !!orgsPoll.error;

  const usersPoll = usePoll<Tagged<User[]>>(
    orgId ? `users:${orgId}` : null,
    async () => {
      const key = orgId!;
      const { users } = await orion.users(key);
      const missing = !users.some((item) => item.id === userRef.current);
      // `npm run ask` joins the founder after the swarm; move to them if nobody chose a person yet.
      const founderJoined = autoUser.current && userRef.current !== DEFAULT_USER && users.some((item) => item.id === DEFAULT_USER);
      if (orgRef.current === key && (missing || founderJoined)) {
        const stored = readStored(userKey(key));
        const keep = users.some((item) => item.id === stored);
        const next = keep ? stored : (defaultUser(users)?.id ?? null);
        autoUser.current = !keep;
        userRef.current = next;
        setUserId(next);
      }
      return { key, value: users };
    },
    5000,
  );
  const users = useMemo(
    () => (usersPoll.data && usersPoll.data.key === orgId ? usersPoll.data.value : []),
    [usersPoll.data, orgId],
  );
  const user = users.find((item) => item.id === userId) ?? null;

  const graphPoll = usePoll<Tagged<GraphResponse>>(
    orgId ? `graph:${orgId}` : null,
    async () => ({ key: orgId!, value: await orion.graph(orgId!) }),
    3000,
  );
  const activityPoll = usePoll<Tagged<ActivityResponse>>(
    orgId ? `activity:${orgId}` : null,
    async () => {
      const key = orgId!;
      const value = await orion.activity(key, 120);
      if (orgRef.current === key) idleOrg.current = value.counts.sources === 0 ? key : null;
      return { key, value };
    },
    2500,
  );
  const graph = graphPoll.data?.key === orgId ? graphPoll.data.value : null;
  const activity = activityPoll.data?.key === orgId ? activityPoll.data.value : null;

  // Announces a dashboard that changed under us: this page's chat, a reset, or `npm run ask` saving one on the backend.
  const seenSpec = useRef<{ key: string; at: number } | null>(null);
  const landSpec = (key: string, dashboard: DashboardSpec) => {
    const at = Date.parse(dashboard.updatedAt) || 0;
    const previous = seenSpec.current;
    if (previous && previous.key === key && at <= previous.at) return;
    seenSpec.current = { key, at };
    if (!previous || previous.key !== key) return;
    if (dashboard.origin === "chat") notify(`Dashboard: ${dashboard.title}`, "dashboard");
    else notify(`Reset to your role: ${dashboard.title}`, "dashboard");
    if (!selectedRef.current) setView("home");
  };

  const dashKey = orgId && userId ? `${orgId}:${userId}` : null;
  const dashPoll = usePoll<Tagged<DashboardSpec>>(
    dashKey,
    async () => {
      const key = dashKey!;
      const { dashboard } = await orion.dashboard(orgId!, userId!);
      landSpec(key, dashboard);
      return { key, value: dashboard };
    },
    3000,
  );
  // A dashboard from chat or reset lands before the next poll; keep whichever is newest so a slow poll cannot undo it.
  const savedSpec = newer(dashPoll.data, override, dashKey);
  const spec = savedSpec?.value ?? fallbackDashboard(user);

  const minute = useNow(30_000);
  const stars = useMemo(
    () => (offline ? STARS : toStars(graph, activity?.sources ?? [], minute)),
    [offline, graph, activity, minute],
  );
  const starsRef = useRef(stars);
  starsRef.current = stars;

  const chooseOrg = (id: string) => {
    if (id === orgId) return;
    writeStored(ORG_KEY, id);
    orgRef.current = id;
    userRef.current = null;
    autoUser.current = true;
    setOrgId(id);
    setUserId(null);
    setHighlightIds([]);
    highlightRef.current = [];
    setSelectedId(null);
  };

  const chooseUser = (id: string) => {
    if (orgId) writeStored(userKey(orgId), id);
    autoUser.current = false;
    userRef.current = id;
    setUserId(id);
  };

  const resetDashboard = async () => {
    if (!orgId || !userId || resetting) return;
    setResetting(true);
    try {
      const { dashboard } = await orion.resetDashboard(orgId, userId);
      landSpec(`${orgId}:${userId}`, dashboard);
      setOverride({ key: `${orgId}:${userId}`, value: dashboard });
    } catch (error) {
      notify(`Reset failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setResetting(false);
    }
  };

  // ---- Chat ------------------------------------------------------------------------

  useEffect(() => {
    const dock = dockRef.current;
    const stage = stageRef.current;
    if (!dock || !stage) return;
    const observer = new ResizeObserver(() => stage.style.setProperty("--dock", `${dock.offsetHeight}px`));
    observer.observe(dock);
    return () => observer.disconnect();
  }, [selectedId]);

  const light = (ids: string[], focus: string[] = ids) => {
    highlightRef.current = ids;
    setHighlightIds(ids);
    setLastId(focus[0] ?? null);
    // During the intro the scroll scrub owns the camera; it reads highlightRef on every frame.
    if (phaseRef.current === "app" && focus.length > 0) mapRef.current?.flyTo(focus);
  };

  const applyView = (command: ViewCommand) => {
    const ids = [...new Set([...command.focusNodeIds, ...command.highlightNodeIds])];
    light(ids, command.focusNodeIds.length ? command.focusNodeIds : ids);
    if (command.caption) notify(command.caption);
  };

  const currentView = (): ViewCommand => ({
    focusNodeIds: selectedRef.current ? [selectedRef.current] : [],
    highlightNodeIds: highlightRef.current,
    visibleDomains: domainFilter ? [domainFilter] : null,
    layout: view === "context" || view === "blocked" ? "list" : "clusters",
    caption: "",
  });

  const askedHere = useRef(false);
  const ask = async (text: string) => {
    askedHere.current = true;
    setReplyOpen(true);
    // The conversation so far goes with the question, so "how would you fix this?" knows what "this" is.
    const history: ChatTurn[] = messages.filter((item) => !item.pending).map((item) => ({ role: item.role, text: item.text }));
    setMessages((current) => [...current, { role: "user", text }, { role: "assistant", text: "", pending: true }]);
    // The streaming reply is the one pending message; it is replaced in place as tokens land.
    const update = (message: Message) =>
      setMessages((current) => {
        const index = current.findIndex((item) => item.pending);
        if (index < 0) return [...current, message];
        const next = [...current];
        next[index] = message;
        return next;
      });

    if (offline || !orgId || !userId) {
      // No backend: answer from the sample data so the page still demos.
      const result = answer(text);
      update({ role: "assistant", text: result.reply });
      light(result.highlightIds ?? [], result.id ? [result.id] : (result.highlightIds ?? []));
      return;
    }
    const key = `${orgId}:${userId}`;
    // The dashboard reshapes on its own fast call and lands the moment it resolves, without waiting for the answer.
    // The server's instant draft lands first (no model, a few ms); the refined spec swaps in quietly after.
    if (isLayoutAsk(text)) {
      setReshaping(true);
      let drafted = false;
      orion
        .askDashboard(orgId, userId, text, (draft) => {
          drafted = true;
          landSpec(key, draft);
          setOverride({ key, value: draft });
        })
        .then(({ dashboard }) => {
          if (!dashboard) return;
          if (drafted) seenSpec.current = { key, at: Date.parse(dashboard.updatedAt) || Date.now() };
          else landSpec(key, dashboard);
          setOverride({ key, value: dashboard });
        })
        .catch(() => {})
        .finally(() => setReshaping(false));
    }
    try {
      // Tokens land in the reply as they arrive; the final message swaps in renumbered citations and next steps.
      let streamed = "";
      const response = await orion.chatStream(
        orgId,
        userId,
        text,
        currentView(),
        (delta) => {
          streamed += delta;
          update({ role: "assistant", text: streamed, pending: true });
        },
        history,
      );
      update({ role: "assistant", text: response.reply, sources: response.sources, actions: response.actions });
      if (response.viewCommand) applyView(response.viewCommand);
      // Demo step "one project": open the project the answer is about.
      if (openAfterAnswer.current) {
        openAfterAnswer.current = false;
        const known = new Set(starsRef.current.map((star) => star.id));
        const named = response.reply.toLowerCase();
        const id =
          [...(response.viewCommand?.focusNodeIds ?? []), ...(response.viewCommand?.highlightNodeIds ?? [])].find((n) => known.has(n)) ??
          response.sources.flatMap((src) => src.changes.map((c) => c.nodeId)).find((n) => known.has(n)) ??
          starsRef.current.find((star) => named.includes(star.label.toLowerCase()))?.id;
        if (id) setSelectedId(id);
      }
    } catch (error) {
      update({ role: "assistant", text: `Orion is unreachable (${error instanceof Error ? error.message : String(error)}). Try again.` });
    }
  };

  // ---- Conversation memory and the opening brief ---------------------------------------

  const convKey = orgId && userId ? `orion:chat:${orgId}:${userId}` : null;
  const loadedConv = useRef<string | null>(null);
  const skipSave = useRef(false);
  // Each person has their own conversation for the browser session; switching people swaps it.
  useEffect(() => {
    if (!convKey) return;
    let stored: Message[] = [];
    try {
      const raw = window.sessionStorage.getItem(convKey);
      if (raw) stored = (JSON.parse(raw) as Message[]).filter((item) => !item.pending && typeof item.text === "string");
    } catch {
      stored = [];
    }
    const first = loadedConv.current === null;
    loadedConv.current = convKey;
    skipSave.current = true;
    // The first load keeps anything asked before the person was known.
    setMessages((current) => (first && !stored.length ? current : stored));
  }, [convKey]);
  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    if (!convKey || loadedConv.current !== convKey) return;
    try {
      window.sessionStorage.setItem(convKey, JSON.stringify(messages.filter((item) => !item.pending).slice(-40)));
    } catch {
      // Blocked storage: the conversation just will not survive a reload.
    }
  }, [messages, convKey]);

  // Once per person per page load, when the app opens: what moved for them, as Orion's first word.
  const briefed = useRef(new Set<string>());
  useEffect(() => {
    if (phase !== "app" || offline || !orgId || !userId || !convKey || briefed.current.has(convKey)) return;
    briefed.current.add(convKey);
    const key = convKey;
    orion
      .brief(orgId, userId)
      .then(({ text, sources }) => {
        if (!text || loadedConv.current !== key) return;
        const brief: Message = { role: "assistant", text, sources, brief: true };
        setReplyOpen(true);
        setMessages((current) => {
          const rest = current.filter((item) => !item.brief);
          // Ahead of a question still being answered (or already answered on this page), so the answer stays last.
          const pending = rest.findIndex((item) => item.pending);
          const asked = askedHere.current ? rest.findLastIndex((item) => item.role === "user") + 1 : -1;
          const at = pending >= 0 ? pending : asked > 0 ? asked : -1;
          if (at < 0) return [...rest, brief];
          const cut = Math.max(0, at - 1);
          return [...rest.slice(0, cut), brief, ...rest.slice(cut)];
        });
      })
      .catch(() => {});
  }, [phase, offline, orgId, userId, convKey]);

  const openAfterAnswer = useRef(false);

  const sendFromMap = (text: string) => {
    noteDemoSent(text);
    void ask(text);
    if (phase === "hero") {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      setPhase(reduce ? "app" : "entering");
    }
  };

  const navigate = (next: View) => {
    setSelectedId(null);
    setDomainFilter(null);
    setView(next);
  };

  // Demo mode (?demo=1): Tab types the step's prompt, arrows move between steps. Inert when off.
  const scrollToCard = (kind: string) => {
    let tries = 0;
    const find = () => {
      const card = document.querySelector(`[data-demo-card="${kind}"]`);
      if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
      else if (++tries < 12) window.setTimeout(find, 250);
    };
    window.setTimeout(find, 350);
  };
  useDemoKeys({
    phase,
    composer: composerRef,
    control: composerControl,
    navigate,
    onStep: (step) => step.scrollTo && scrollToCard(step.scrollTo),
    onSent: (step) => {
      openAfterAnswer.current = !!step.openFocus;
    },
    onAdvance: () => setSelectedId(null),
  });
  const demoScroll = demo.step?.scrollTo;
  const specStamp = `${savedSpec?.value.updatedAt ?? ""}|${savedSpec?.value.title ?? ""}`;
  useEffect(() => {
    if (demoScroll && view === "home") scrollToCard(demoScroll);
    // Only when the dashboard reshapes while a scrolling step is up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specStamp]);

  const showDomain = (domain: Domain) => {
    setSelectedId(null);
    setDomainFilter(domain);
    setView("context");
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
    if (phase !== "app" || selectedId || (view !== "map" && view !== "home")) return;
    mapRef.current?.lookAt(highlightRef.current, 1);
  }, [phase, selectedId, view]);

  const prompts = promptsForRole(user?.role);
  const actions: QuickActionItem[] = prompts.map((prompt, index) => ({
    icon: ACTION_ICONS[index % ACTION_ICONS.length],
    label: prompt,
    prompt,
  }));

  const selected = stars.find((star) => star.id === selectedId);
  if (phase === "app" && selected) {
    return (
      <>
        <StarDashboard
          star={selected}
          stars={stars}
          messages={messages}
          onSend={(text) => void ask(text)}
          onAnswer={(text, reply) => {
            setReplyOpen(true);
            setMessages((current) => [...current, { role: "user", text }, { role: "assistant", text: reply }]);
          }}
          onSelect={setSelectedId}
          onNavigate={navigate}
        />
        <Toasts toasts={toasts} reshaping={reshaping} lower={demo.on && !demo.hidden} />
        <SourceViewer orgId={orgId} />
        <DemoCaption intro={false} />
      </>
    );
  }

  const last = messages.at(-1);
  const question = messages.at(-2)?.role === "user" ? messages.at(-2)?.text : undefined;
  const inDomain = domainFilter ? stars.filter((star) => star.domain === domainFilter) : stars;
  const listed =
    view === "blocked"
      ? stars.filter((star) => star.status === "blocked")
      : [...inDomain].sort((a, b) => Number(a.status === "done") - Number(b.status === "done"));
  const showMap = phase !== "app" || view === "map";
  const map = (
    <StarMap ref={mapRef} stars={stars} highlightIds={highlightIds} onSelect={setSelectedId} onMore={showDomain} />
  );

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
          <span className="flex min-w-0 items-center gap-2.5">
            <Logo />
            <span className="hidden text-[14px] font-semibold tracking-[-0.01em] sm:inline">Orion</span>
            {orgs.length > 0 && (
              <>
                <span className="hidden text-line-strong sm:inline">/</span>
                <Picker
                  label="Organization"
                  current={orgs.find((org) => org.id === orgId)?.name ?? "Choose org"}
                  value={orgId}
                  options={orgs.map((org: OrgSummary) => ({
                    id: org.id,
                    title: org.name,
                    detail: `${org.members} ${org.members === 1 ? "person" : "people"}${org.id === "demo" ? " · sample" : ""}`,
                  }))}
                  onPick={chooseOrg}
                />
              </>
            )}
          </span>
          <div
            onClick={onNav}
            onKeyDown={onNav}
            className={cn("[&>div]:min-h-0 [&>div]:px-0 max-md:[&_nav]:gap-4 max-sm:hidden", ACTIVE[view])}
          >
            <RandomLetterSwapNav links={NAV} />
          </div>
          <span className="flex min-w-0 items-center justify-end gap-4">
            <LiveStatus offline={offline} graph={graph} activity={activity} stars={stars.length} />
            {users.length > 0 && (
              <Picker
                label="Viewing as"
                align="right"
                current={user?.name ?? "Choose person"}
                value={userId}
                options={users.map((item) => ({ id: item.id, title: item.name, detail: item.role }))}
                onPick={chooseUser}
              />
            )}
          </span>
        </header>

        <div
          className="absolute inset-x-0 top-14"
          style={{ bottom: phase === "app" ? 0 : "calc(var(--dock, 200px) + 32px)" }}
          inert={phase !== "app"}
        >
          {showMap ? (
            <div className="relative h-full px-4 pt-4">
              <div
                className="absolute top-5 left-6 z-10 hidden md:block"
                style={{ opacity: "var(--header)" }}
              >
                <p className="text-[14px] font-medium">Company map</p>
                <p className="mt-0.5 max-w-56 text-[13px] text-faint">
                  {highlightIds.length
                    ? stars
                        .filter((star) => highlightIds.includes(star.id))
                        .map((star) => star.label)
                        .join(", ") || "Click a project for details"
                    : stars.length
                      ? "Click a project for details"
                      : "Waiting for the first capture"}
                </p>
                {demo.on && (
                  <p className="mt-4 font-mono text-[11px] tracking-wide text-muted uppercase">Teams → projects</p>
                )}
                <div className={demo.on ? "mt-2" : "mt-4"}>
                  <MapLegend />
                </div>
              </div>
              <div className="h-full max-sm:hidden">{map}</div>
              <div className="h-full sm:hidden">
                <CompactMap stars={stars} highlightIds={highlightIds} onSelect={setSelectedId} />
              </div>
            </div>
          ) : view === "home" ? (
            <div className="thin-scroll h-full overflow-auto" style={{ paddingBottom: "calc(var(--dock, 200px) + 40px)" }}>
              {dashKey && spec.origin === "chat" && <ResetBar resetting={resetting} onReset={resetDashboard} />}
              {/* Widgets are keyed by id inside, so a rebuilt spec reshapes in place instead of remounting. */}
              <DynamicDashboard
                spec={spec}
                graph={offline ? null : graph}
                activity={offline ? null : activity}
                orgId={orgId ?? "demo"}
                highlightIds={highlightIds}
                onSelectNode={setSelectedId}
                renderMap={() => <div className="h-full">{map}</div>}
              />
            </div>
          ) : (
            <ContextList
              title={view === "blocked" ? "Blocked" : domainFilter ? DOMAIN_LABEL[domainFilter] : "Context"}
              description={
                view === "blocked"
                  ? "Work that is waiting on something else."
                  : domainFilter
                    ? `Every ${DOMAIN_LABEL[domainFilter].toLowerCase()} project Orion knows about.`
                    : "How the work connects."
              }
              stars={listed}
              empty={view === "blocked" ? "Nothing is blocked." : "Nothing captured yet. Run the swarm and this fills in."}
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
            bottom: "calc(50% + 232px)",
            opacity: "var(--title)",
            filter: "blur(calc((1 - var(--title)) * 12px))",
            transform: "translateY(calc((1 - var(--title)) * -28px))",
          }}
        >
          <h1 className="orion-wordmark font-display text-[clamp(88px,15vw,168px)] leading-[0.84] font-normal tracking-[-0.035em]">
            Orion
          </h1>
          <p className="orion-wordmark mx-auto mt-5 max-w-xl text-[15px] leading-relaxed tracking-[0.01em] text-balance text-muted [animation-delay:180ms]">
            {user ? `Hi ${user.name.split(" ")[0]}. Ask what your team is working on.` : "Ask what your team is working on."} The map
            shows the rest.
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
          {last?.role === "assistant" && replyOpen && phase !== "hero" && (
            <ReplyDock
              question={question ?? (last.brief ? "Your brief" : "")}
              messages={messages}
              onSend={sendFromMap}
              onClose={() => setReplyOpen(false)}
              keepOpen={demo.on}
            />
          )}
          {phase === "app" && !last?.pending && (
            <div className="mb-2 flex gap-2 overflow-x-auto pr-6 [mask-image:linear-gradient(to_right,black_88%,transparent)] [scrollbar-width:none]">
              {prompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => sendFromMap(prompt)}
                  className="shrink-0 rounded-full border border-line-strong bg-bg/80 px-3 py-1 text-[12px] text-muted backdrop-blur-md transition-colors duration-150 hover:border-[#4a4a4a] hover:text-ink"
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}
          <RuixenMoonChat
            ref={composerRef}
            control={composerControl}
            onSend={sendFromMap}
            onType={(delta) => {
              if (!delta) return;
              const step = Math.min(Math.abs(delta), 4);
              holeRef.current?.kick((delta > 0 ? 0.7 : -0.7) * step);
            }}
            autoFocus
            actions={phase === "hero" ? actions : undefined}
            placeholder={phase === "hero" ? "Ask what your team is working on" : "Ask, or say what to show"}
          />
        </div>

        <Toasts toasts={toasts} reshaping={reshaping} lower={demo.on && !demo.hidden} />
        <SourceViewer orgId={orgId} />
        <DemoCaption intro={phase !== "app"} />
      </div>
    </div>
  );
}

/** Hides the scope prefix the project panel adds ("About \"X\": ") when showing a question back. */
const plainQuestion = (text: string) => text.replace(/^About "[^"]*":\s*/, "");

/**
 * The answer above the composer, kept out of the way: the latest reply only, a few lines tall. A few seconds after it
 * finishes it folds into a one-line pill; hovering or clicking opens it again, and earlier turns sit behind "Earlier".
 */
function ReplyDock({
  question,
  messages,
  onSend,
  onClose,
  keepOpen = false,
}: {
  question: string;
  messages: Message[];
  onSend: (text: string) => void;
  onClose: () => void;
  /** Demo mode: the answer stays up while the presenter talks over it. */
  keepOpen?: boolean;
}) {
  const last = messages.at(-1)!;
  const [folded, setFolded] = useState(false);
  const [hover, setHover] = useState(false);
  const [history, setHistory] = useState(false);
  useEffect(() => {
    setFolded(false);
    setHistory(false);
  }, [messages.length]);
  useEffect(() => {
    if (keepOpen || last.pending || hover || history) return;
    const t = window.setTimeout(() => setFolded(true), 7000);
    return () => window.clearTimeout(t);
  }, [keepOpen, last.pending, last.text, hover, history]);
  const earlier = messages.slice(0, -2).slice(-6);

  if (folded && !hover) {
    return (
      <button
        type="button"
        onClick={() => setFolded(false)}
        onMouseEnter={() => setHover(true)}
        className="mb-2 flex w-full items-center gap-2 rounded-full border border-line bg-panel/70 px-3 py-1.5 text-left text-[12px] text-muted backdrop-blur-md transition-colors hover:text-ink"
      >
        <span className="size-1.5 shrink-0 rounded-full bg-ink/70" />
        <span className="truncate">{last.text.replace(/\[[^\]]*\]/g, "").split(/(?<=[.!?])\s/)[0]}</span>
      </button>
    );
  }

  return (
    <div
      className="mb-2 rounded-2xl border border-line bg-panel/80 px-3 py-2 backdrop-blur-md"
      style={{ opacity: "var(--reply)" }}
      aria-live="polite"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-[11.5px] text-faint">{plainQuestion(question)}</p>
        <div className="flex shrink-0 items-center gap-1">
          {earlier.length > 0 && (
            <button
              type="button"
              onClick={() => setHistory((v) => !v)}
              className="rounded-full px-1.5 text-[11px] text-faint hover:text-ink"
            >
              {history ? "Hide" : "Earlier"}
            </button>
          )}
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-full p-0.5 text-faint hover:text-ink">
            <X className="size-3.5" />
          </button>
        </div>
      </div>
      {history && (
        <div className="thin-scroll mt-1 max-h-32 space-y-1.5 overflow-auto border-b border-line pr-1 pb-1.5 opacity-70">
          {earlier.map((m, i) =>
            m.role === "user" ? (
              <p key={i} className="text-[11.5px] text-faint">{plainQuestion(m.text)}</p>
            ) : (
              <ReplyText key={i} text={m.text} sources={m.sources} className="text-[12px] leading-snug text-muted" />
            ),
          )}
        </div>
      )}
      <div className="thin-scroll mt-0.5 max-h-24 overflow-auto pr-1">
        <ReplyText
          text={last.text}
          sources={last.sources}
          streaming={last.pending}
          className="text-[13px] leading-snug text-[#d4d4d4]"
        />
      </div>
      {!last.pending && <ActionPills actions={last.actions} onSend={onSend} className="mt-1.5" />}
    </div>
  );
}

/** The way back from a chat-built dashboard to the one composed from the person's role. */
function ResetBar({ resetting, onReset }: { resetting: boolean; onReset: () => void }) {
  return (
    <div className="mx-auto -mb-4 flex w-full max-w-[1400px] justify-end px-4 pt-5 md:-mb-6 md:px-8">
      <button
        type="button"
        onClick={onReset}
        disabled={resetting}
        className="flex items-center gap-1.5 rounded-full border border-line-strong px-3 py-1 text-[13px] text-muted transition-colors hover:border-[#4a4a4a] hover:text-ink disabled:opacity-50"
      >
        <RotateCcw className={cn("size-3.5", resetting && "animate-spin [animation-direction:reverse]")} />
        Reset to my role
      </button>
    </div>
  );
}

/** Pulse, counts, and the newest capture, so the swarm is visibly landing. */
function LiveStatus({
  offline,
  graph,
  activity,
  stars,
}: {
  offline: boolean;
  graph: GraphResponse | null;
  activity: ActivityResponse | null;
  stars: number;
}) {
  const now = useNow(1000);
  const latest = activity?.sources[0];
  const fresh = latest ? now - Date.parse(latest.createdAt) < 15_000 : false;
  if (offline) {
    return (
      <span className="hidden items-center gap-2 font-mono text-[12px] tracking-wide text-faint uppercase md:flex">
        <span className="size-1.5 rounded-full bg-faint" />
        Offline · sample data
      </span>
    );
  }
  const nodes = activity?.counts.nodes ?? graph?.nodes.length ?? stars;
  const sources = activity?.counts.sources ?? 0;
  return (
    <span className="hidden min-w-0 items-center gap-3 md:flex">
      <span className="flex shrink-0 items-center gap-2 font-mono text-[12px] tracking-wide text-faint uppercase">
        <span className={cn("relative size-1.5 rounded-full", fresh ? "orion-live bg-ink text-ink" : "bg-muted")} />
        {nodes} nodes · {sources} sources
      </span>
      {latest && (
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.button
            type="button"
            onClick={() => openSource(latest.id)}
            key={latest.id}
            initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="hidden max-w-[360px] min-w-0 truncate text-left text-[13px] text-muted transition-colors hover:text-ink xl:block"
            title={`Open ${latest.title}`}
          >
            {captureLine(latest)} <span className="text-faint">{ago(latest.createdAt, now)}</span>
          </motion.button>
        </AnimatePresence>
      )}
    </span>
  );
}

type PickerOption = { id: string; title: string; detail?: string };

function Picker({
  label,
  current,
  value,
  options,
  onPick,
  align = "left",
}: {
  label: string;
  current: string;
  value: string | null;
  options: PickerOption[];
  onPick: (id: string) => void;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current}`}
        onClick={() => setOpen((value) => !value)}
        className="flex max-w-[22ch] min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[14px] text-muted transition-colors hover:bg-panel hover:text-ink"
      >
        <span className="truncate">{current}</span>
        <ChevronDown className={cn("size-3.5 shrink-0 transition-transform duration-200", open && "rotate-180")} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="listbox"
            aria-label={label}
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "thin-scroll absolute top-full z-50 mt-2 max-h-[60vh] w-72 overflow-auto rounded-xl border border-line-strong bg-panel p-1.5 shadow-[0_16px_50px_rgba(0,0,0,0.6)]",
              align === "right" ? "right-0 origin-top-right" : "left-0 origin-top-left",
            )}
          >
            <p className="px-2.5 pt-1.5 pb-1 font-mono text-[11px] tracking-[0.12em] text-faint uppercase">{label}</p>
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={option.id === value}
                onClick={() => {
                  onPick(option.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 hover:bg-raised",
                  option.id === value && "bg-raised",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-ink">{option.title}</span>
                  {option.detail && <span className="line-clamp-2 text-[12px] leading-snug text-faint">{option.detail}</span>}
                </span>
                {option.id === value && <Check className="mt-0.5 size-3.5 shrink-0 text-ink" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Mirrors the backend's pre-check: only these messages can reshape the dashboard, so only they show the pill.
const LAYOUT_ASK =
  /\b(show|dashboard|board|focus|track|view|only|just|add|remove|put|switch|rebuild|replace|swap|hide|pin|widgets?|chart|kpi|layout|display|see|watch|monitor|i am|i'm|im a|as a|my role)\b/i;
// A bare filter phrase ("blocked marketing work") reshapes too, unless it reads as a question.
const FILTER_ASK = /\b(blocked|at risk|on track|done|shipped|marketing|sales|engineering|ops|deals?|campaigns?|google ads|hubspot|commits?|today|this week|mine)\b/i;
const QUESTION_ASK = /\?\s*$|^\s*(what|who|why|how|when|where|which|is|are|does|do|did|can|could|should|will|would)\b/i;
const isLayoutAsk = (text: string) => LAYOUT_ASK.test(text) || (FILTER_ASK.test(text) && !QUESTION_ASK.test(text));

function Toasts({ toasts, reshaping = false, lower = false }: { toasts: Toast[]; reshaping?: boolean; lower?: boolean }) {
  return (
    <div
      className={cn("pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4", lower ? "top-[108px]" : "top-[68px]")}
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
        {reshaping && (
          <motion.div
            key="reshaping"
            layout
            initial={{ opacity: 0, y: -10, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -6, filter: "blur(6px)" }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="flex items-center gap-2.5 rounded-full border border-white/70 bg-black/85 px-4 py-2 text-[13px] text-ink backdrop-blur-md"
          >
            <Sparkles className="size-3.5 shrink-0 animate-pulse" strokeWidth={1.75} />
            <span className="orion-shimmer">Reshaping dashboard…</span>
          </motion.div>
        )}
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            initial={{ opacity: 0, y: -10, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -6, filter: "blur(6px)" }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "flex max-w-[min(520px,100%)] items-center gap-2.5 rounded-full border bg-black/85 px-4 py-2 text-[13px] backdrop-blur-md",
              toast.kind === "dashboard" ? "border-white/70 text-ink" : "border-line-strong text-muted",
            )}
          >
            {toast.kind === "dashboard" && <Sparkles className="size-3.5 shrink-0" strokeWidth={1.75} />}
            <span className="truncate">{toast.text}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
