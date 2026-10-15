"use client";

// The signed-in app: the hero and intro, the header, the four views (Home, Map, Context, Blocked), the project
// page, and the chat dock. Data and behavior live in the use* hooks next to this file.

import { useSession } from "@/components/auth/session";
import { ContextList } from "@/components/context/ContextList";
import { DynamicDashboard } from "@/components/dashboard/DynamicDashboard";
import { CompactMap } from "@/components/map/CompactMap";
import { MapLegend } from "@/components/map/MapLegend";
import { type MapCamera, StarMap } from "@/components/map/StarMap";
import { ProjectPage } from "@/components/project/ProjectPage";
import { BlackHole, type BlackHoleHandle } from "@/components/ui/black-hole";
import { Logo } from "@/components/ui/Logo";
import RandomLetterSwapNav from "@/components/ui/m-random-letter-swap-1";
import RuixenMoonChat, { type QuickActionItem } from "@/components/ui/ruixen-moon-chat";
import { SourceViewer } from "@/components/viewer/SourceViewer";
import type { ChatTurn, Domain, OrgSummary, ViewCommand } from "@/lib/api/types";
import { isLayoutAsk, type Message, promptsForRole } from "@/lib/chat";
import { DOMAIN_LABEL } from "@/lib/domain";
import { friendlyError } from "@/lib/errors";
import { api } from "@/lib/api/client";
import { toStars } from "@/lib/stars";
import { useNow } from "@/lib/time";
import { cn } from "@/lib/utils";
import { CircleAlert, Megaphone, TrendingUp } from "lucide-react";
import { type ComposerControl, DemoCaption, noteDemoSent, scrollToCard, useDemo, useDemoKeys } from "orion-demo";
import { type KeyboardEvent, type MouseEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { APP_VARS, BEATS, HERO_VARS, type Phase, useIntroScroll } from "./intro";
import { LiveStatus } from "./LiveStatus";
import { Picker } from "./Picker";
import { ReplyDock } from "./ReplyDock";
import { ResetBar } from "./ResetBar";
import { Toasts } from "./Toasts";
import { useConversation } from "./useConversation";
import { useDashboardSpec } from "./useDashboardSpec";
import { useToasts } from "./useToasts";
import { useWorkspace } from "./useWorkspace";

type View = "home" | "map" | "context" | "blocked";

const NAV = ["Home", "Map", "Context", "Blocked", "Ask"];

const ACTIVE: Record<View, string> = {
  home: "[&_[data-label='Home']]:text-foreground",
  map: "[&_[data-label='Map']]:text-foreground",
  context: "[&_[data-label='Context']]:text-foreground",
  blocked: "[&_[data-label='Blocked']]:text-foreground",
};

const ACTION_ICONS = [TrendingUp, CircleAlert, Megaphone];

export function AppShell() {
  const { me } = useSession();
  const [phase, setPhase] = useState<Phase>("hero");
  const [view, setView] = useState<View>("home");
  const [domainFilter, setDomainFilter] = useState<Domain | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightIds, setHighlightIds] = useState<string[]>([]);
  const [replyOpen, setReplyOpen] = useState(true);
  const sectionRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const composerControl = useRef<ComposerControl>(null);
  const holeRef = useRef<BlackHoleHandle>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapCamera>(null);
  const highlightRef = useRef<string[]>([]);
  const phaseRef = useRef(phase);
  const selectedRef = useRef(selectedId);
  const openAfterAnswer = useRef(false);
  const demo = useDemo();

  useEffect(() => {
    phaseRef.current = phase;
    selectedRef.current = selectedId;
  });

  const { toasts, notify } = useToasts();
  const ws = useWorkspace({ signedInUser: me.userId });
  const { orgs, orgId, users, userId, user, graph, activity } = ws;
  const dash = useDashboardSpec({
    orgId,
    userId,
    user,
    notify,
    onChanged: () => {
      if (!selectedRef.current) setView("home");
    },
  });
  const { messages, setMessages, noteAsked } = useConversation({
    orgId,
    userId,
    briefNow: phase === "app",
    onBrief: () => setReplyOpen(true),
  });

  const minute = useNow(30_000);
  const stars = useMemo(() => toStars(graph, activity?.sources ?? [], minute), [graph, activity, minute]);

  const chooseOrg = (id: string) => {
    if (id === orgId) return;
    ws.chooseOrg(id);
    setHighlightIds([]);
    highlightRef.current = [];
    setSelectedId(null);
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

  const ask = async (text: string) => {
    noteAsked();
    setReplyOpen(true);
    // The conversation so far goes with the question, so "how would you fix this?" knows what "this" is.
    const history: ChatTurn[] = messages.filter((item) => !item.pending && !item.failed).map((item) => ({ role: item.role, text: item.text }));
    setMessages((current) => [...current.filter((item) => !item.failed), { role: "user", text }, { role: "assistant", text: "", pending: true }]);
    // The streaming reply is the one pending message; it is replaced in place as tokens land.
    const update = (message: Message) =>
      setMessages((current) => {
        const index = current.findIndex((item) => item.pending);
        if (index < 0) return [...current, message];
        const next = [...current];
        next[index] = message;
        return next;
      });

    if (!orgId || !userId) {
      update({ role: "assistant", text: "Orion is still loading your workspace. Try again in a moment.", failed: { question: text } });
      return;
    }
    // The dashboard reshapes on its own fast call and lands the moment it resolves, without waiting for the answer.
    if (isLayoutAsk(text)) dash.reshape(text);
    try {
      // Tokens land in the reply as they arrive; the final message swaps in renumbered citations and next steps.
      let streamed = "";
      const response = await api.chat(
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
        const known = new Set(stars.map((star) => star.id));
        const named = response.reply.toLowerCase();
        const id =
          [...(response.viewCommand?.focusNodeIds ?? []), ...(response.viewCommand?.highlightNodeIds ?? [])].find((n) => known.has(n)) ??
          response.sources.flatMap((src) => src.changes.map((c) => c.nodeId)).find((n) => known.has(n)) ??
          stars.find((star) => named.includes(star.label.toLowerCase()))?.id;
        if (id) setSelectedId(id);
      }
    } catch (error) {
      update({ role: "assistant", text: friendlyError(error, "ask Orion"), failed: { question: text } });
    }
  };

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

  // Demo mode (NEXT_PUBLIC_ORION_DEMO builds, ?demo=1): Tab types the step's prompt, arrows move between steps.
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
  const specStamp = `${dash.saved?.updatedAt ?? ""}|${dash.saved?.title ?? ""}`;
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

  useIntroScroll({ phase, sectionRef, stageRef, mapRef, highlightRef, onFinish: () => setPhase("app") });

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
        <ProjectPage
          star={selected}
          stars={stars}
          messages={messages}
          onSend={(text) => void ask(text)}
          onSelect={setSelectedId}
          onNavigate={navigate}
        />
        <Toasts toasts={toasts} reshaping={dash.reshaping} lower={demo.on && !demo.hidden} />
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
  const map = <StarMap ref={mapRef} stars={stars} highlightIds={highlightIds} onSelect={setSelectedId} onMore={showDomain} />;

  return (
    <div ref={sectionRef} className={cn("relative", phase === "entering" ? "h-[460vh]" : "h-dvh")}>
      <div
        ref={stageRef}
        style={phase === "app" ? APP_VARS : HERO_VARS}
        className={cn("h-dvh overflow-hidden bg-bg text-ink", phase === "entering" ? "fixed inset-0" : "sticky top-0")}
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
          <div className="pointer-events-none absolute inset-x-0 top-0 z-40 h-px bg-white/80" style={{ width: "calc(var(--progress) * 100%)" }} />
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
                    detail: `${org.members} ${org.members === 1 ? "person" : "people"}`,
                  }))}
                  onPick={chooseOrg}
                />
              </>
            )}
          </span>
          <div onClick={onNav} onKeyDown={onNav} className={cn("[&>div]:min-h-0 [&>div]:px-0 max-md:[&_nav]:gap-4 max-sm:hidden", ACTIVE[view])}>
            <RandomLetterSwapNav links={NAV} />
          </div>
          <span className="flex min-w-0 items-center justify-end gap-4">
            <LiveStatus offline={ws.unreachable} graph={graph} activity={activity} stars={stars.length} />
            {users.length > 0 && (
              <Picker
                label="Viewing as"
                align="right"
                current={user?.name ?? "Choose person"}
                value={userId}
                options={users.map((item) => ({ id: item.id, title: item.name, detail: item.role }))}
                onPick={ws.chooseUser}
              />
            )}
          </span>
        </header>

        <div className="absolute inset-x-0 top-14" style={{ bottom: phase === "app" ? 0 : "calc(var(--dock, 200px) + 32px)" }} inert={phase !== "app"}>
          {showMap ? (
            <div className="relative h-full px-4 pt-4">
              <div className="absolute top-5 left-6 z-10 hidden md:block" style={{ opacity: "var(--header)" }}>
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
                {demo.on && <p className="mt-4 font-mono text-[11px] tracking-wide text-muted uppercase">Teams → projects</p>}
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
              {dash.key && dash.spec.origin === "chat" && <ResetBar resetting={dash.resetting} onReset={dash.reset} />}
              {/* Widgets are keyed by id inside, so a rebuilt spec reshapes in place instead of remounting. */}
              <DynamicDashboard
                spec={dash.spec}
                graph={graph}
                activity={activity}
                orgId={orgId ?? ""}
                highlightIds={highlightIds}
                onSelectNode={setSelectedId}
                renderMap={() => <div className="h-full">{map}</div>}
              />
            </div>
          ) : (
            <ContextList
              orgId={orgId}
              title={view === "blocked" ? "Blocked" : domainFilter ? DOMAIN_LABEL[domainFilter] : "Context"}
              description={
                view === "blocked"
                  ? "Work that is waiting on something else."
                  : domainFilter
                    ? `Every ${DOMAIN_LABEL[domainFilter].toLowerCase()} project Orion knows about.`
                    : "How the work connects."
              }
              stars={listed}
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
          <h1 className="orion-wordmark font-display text-[clamp(88px,15vw,168px)] leading-[0.84] font-normal tracking-[-0.035em]">Orion</h1>
          <p className="orion-wordmark mx-auto mt-5 max-w-xl text-[15px] leading-relaxed tracking-[0.01em] text-balance text-muted [animation-delay:180ms]">
            {user ? `Hi ${user.name.split(" ")[0]}. Ask what your team is working on.` : "Ask what your team is working on."} The map shows the
            rest.
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

        <Toasts toasts={toasts} reshaping={dash.reshaping} lower={demo.on && !demo.hidden} />
        <SourceViewer orgId={orgId} />
        <DemoCaption intro={phase !== "app"} />
      </div>
    </div>
  );
}
