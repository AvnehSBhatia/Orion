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
import { Quiet } from "@/components/ui/Quiet";
import RuixenMoonChat, { type QuickActionItem } from "@/components/ui/ruixen-moon-chat";
import { SourceViewer } from "@/components/viewer/SourceViewer";
import type { ChatTurn, Domain, OrgSummary, ViewCommand } from "@/lib/api/types";
import { isLayoutAsk, type Message, promptsForRole } from "@/lib/chat";
import { DOMAIN_LABEL } from "@/lib/domain";
import { friendlyError } from "@/lib/errors";
import { api } from "@/lib/api/client";
import { toStars } from "@/lib/stars";
import { INTRO_SEEN_KEY, readStored, writeStored } from "@/lib/storage";
import { ago, useNow } from "@/lib/time";
import { cn } from "@/lib/utils";
import { CircleAlert, Megaphone, TrendingUp } from "lucide-react";
import { type ComposerControl, DemoCaption, noteDemoSent, scrollToCard, useDemo, useDemoKeys } from "orion-demo";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AccountMenu, accountLinks } from "./AccountMenu";
import { APP_VARS, BEATS, HERO_VARS, type Phase, useIntroScroll } from "./intro";
import { type Connection, LiveStatus } from "./LiveStatus";
import { MobileMenu, Nav, type View } from "./Nav";
import { Onboarding } from "./Onboarding";
import { Picker } from "./Picker";
import { ReplyDock } from "./ReplyDock";
import { ResetBar } from "./ResetBar";
import { Toasts } from "./Toasts";
import { useConversation } from "./useConversation";
import { useDashboardSpec } from "./useDashboardSpec";
import { useToasts } from "./useToasts";
import { useWorkspace } from "./useWorkspace";

/** Answers slower than this are cut off with a friendly message and a Retry. */
const CHAT_TIMEOUT_MS = 90_000;

/** Returning visitors, and anyone on a touch screen (the scroll scrub is desktop-only), skip the intro. */
function initialPhase(): Phase {
  if (typeof window === "undefined") return "hero";
  return readStored(INTRO_SEEN_KEY) ? "app" : "hero";
}

const ACTION_ICONS = [TrendingUp, CircleAlert, Megaphone];

export function AppShell() {
  const { me, signOut } = useSession();
  const [phase, setPhase] = useState<Phase>(initialPhase);
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
  useEffect(() => {
    if (phase === "app") writeStored(INTRO_SEEN_KEY, "1");
  }, [phase]);

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

  const ask = async (text: string, { retry = false } = {}) => {
    noteAsked();
    setReplyOpen(true);
    // A retry replaces the failed question and its error, so the conversation reads as one ask.
    const dropFailed = (list: Message[]) => {
      const at = list.findIndex((item) => item.failed);
      if (at < 0) return list;
      return list.filter((_, i) => i !== at && !(retry && i === at - 1 && list[i].role === "user"));
    };
    // The conversation so far goes with the question, so "how would you fix this?" knows what "this" is.
    const history: ChatTurn[] = dropFailed(messages)
      .filter((item) => !item.pending)
      .map((item) => ({ role: item.role, text: item.text }));
    setMessages((current) => [...dropFailed(current), { role: "user", text }, { role: "assistant", text: "", pending: true }]);
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
        AbortSignal.timeout(CHAT_TIMEOUT_MS),
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

  const sendFromMap = (text: string, options?: { retry?: boolean }) => {
    noteDemoSent(text);
    void ask(text, options);
    if (phase === "hero") {
      // The scrub is a desktop moment: reduced motion, touch screens, and repeat visits go straight in.
      const skip =
        window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
        window.matchMedia("(pointer: coarse)").matches ||
        !!readStored(INTRO_SEEN_KEY);
      setPhase(skip ? "app" : "entering");
    }
  };

  const goHome = () => {
    setSelectedId(null);
    setDomainFilter(null);
    setView("home");
    setPhase("hero");
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

  const focusComposer = () => composerRef.current?.focus();

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
          onRetry={(text) => void ask(text, { retry: true })}
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
  const connection: Connection = ws.unreachable ? "down" : ws.reconnecting ? "reconnecting" : "live";
  const org = orgs.find((item) => item.id === orgId) ?? null;
  const empty = !!graph && graph.nodes.length === 0 && (activity?.counts.sources ?? 0) === 0;
  const canViewAs = !!(me.admin || me.authDisabled);
  const who = [user?.name ?? me.username, org?.name].filter(Boolean).join(" · ");
  const map = <StarMap ref={mapRef} stars={stars} highlightIds={highlightIds} onSelect={setSelectedId} onMore={showDomain} />;

  return (
    <div ref={sectionRef} className={cn("relative", phase === "entering" ? "h-[460vh]" : "h-dvh")}>
      <div
        ref={stageRef}
        style={phase === "app" ? APP_VARS : HERO_VARS}
        className={cn("h-dvh overflow-hidden bg-bg text-ink", phase === "entering" ? "fixed inset-0" : "sticky top-0")}
      >
        {phase === "app" && (
          <a
            href="#main"
            className="sr-only z-[70] rounded-md bg-ink px-3 py-2 text-[13px] text-bg focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
          >
            Skip to content
          </a>
        )}
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
        {phase === "hero" && <AccountMenu name={me.userId === user?.id ? user?.name : undefined} orgName={org?.name} className="absolute top-3 right-4 z-30" />}
        {phase === "entering" && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-40 h-px bg-white/80" style={{ width: "calc(var(--progress) * 100%)" }} />
        )}

        <header
          className="absolute inset-x-0 top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-line bg-bg px-4 md:px-6"
          style={{ opacity: "var(--header)" }}
          inert={phase !== "app"}
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <MobileMenu
              view={view}
              onNavigate={navigate}
              onAsk={focusComposer}
              links={accountLinks(me.admin)}
              onSignOut={me.authDisabled ? undefined : () => void signOut()}
              who={who}
            />
            <button
              type="button"
              onClick={goHome}
              aria-label="Orion: back to the start screen"
              className="flex items-center gap-2.5 rounded-md"
            >
              <Logo />
              <span className="hidden text-[14px] font-semibold tracking-[-0.01em] sm:inline">Orion</span>
            </button>
            {orgs.length > 1 ? (
              <>
                <span className="hidden text-line-strong sm:inline">/</span>
                <Picker
                  label="Organization"
                  current={org?.name ?? "Choose org"}
                  value={orgId}
                  options={orgs.map((item: OrgSummary) => ({
                    id: item.id,
                    title: item.name,
                    detail: `${item.members} ${item.members === 1 ? "person" : "people"}`,
                  }))}
                  onPick={chooseOrg}
                />
              </>
            ) : org ? (
              <>
                <span className="hidden text-line-strong sm:inline">/</span>
                <span className="truncate px-2 text-[14px] text-muted">{org.name}</span>
              </>
            ) : null}
          </span>
          <Nav view={view} onNavigate={navigate} onAsk={focusComposer} />
          <span className="flex min-w-0 items-center justify-end gap-3 md:gap-4">
            <LiveStatus connection={connection} lastOk={ws.lastOk} graph={graph} activity={activity} stars={stars.length} />
            {canViewAs && users.length > 1 && (
              <Picker
                label="Viewing as"
                align="right"
                current={user?.name ?? "Choose person"}
                value={userId}
                options={users.map((item) => ({ id: item.id, title: item.name, detail: item.role }))}
                onPick={ws.chooseUser}
              />
            )}
            <AccountMenu name={me.userId === user?.id ? user?.name : undefined} orgName={org?.name} className="max-sm:hidden" />
          </span>
        </header>

        {phase === "app" && connection !== "live" && (
          <div
            role="status"
            className="absolute inset-x-0 top-14 z-[15] flex items-center justify-center gap-2 border-b border-line bg-panel px-4 py-1.5 text-[13px] text-muted"
          >
            <span className="size-1.5 animate-pulse rounded-full bg-faint" />
            {connection === "down"
              ? "Can't reach Orion. Retrying…"
              : `Reconnecting… Showing what was there ${ws.lastOk ? ago(new Date(ws.lastOk).toISOString(), minute) : "earlier"}.`}
          </div>
        )}

        <main
          id="main"
          tabIndex={-1}
          className="absolute inset-x-0 top-14 outline-none"
          style={{ bottom: phase === "app" ? 0 : "calc(var(--dock, 200px) + 32px)" }}
          inert={phase !== "app"}
        >
          {ws.unreachable && !graph ? (
            <div className="flex h-full items-center justify-center px-6" style={{ paddingBottom: "calc(var(--dock, 200px) + 40px)" }}>
              <div className="max-w-sm text-center">
                <Quiet title="Can't reach Orion right now" detail="Your data is safe. This page retries on its own every few seconds." />
              </div>
            </div>
          ) : showMap ? (
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
                      : graph
                        ? "Nothing captured yet"
                        : "Loading"}
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
          ) : view === "home" && empty ? (
            <div className="thin-scroll h-full overflow-auto" style={{ paddingBottom: "calc(var(--dock, 200px) + 40px)" }}>
              <Onboarding org={org} users={users} activity={activity} />
            </div>
          ) : view === "blocked" && listed.length === 0 && graph ? (
            <div className="flex h-full items-center justify-center px-6" style={{ paddingBottom: "calc(var(--dock, 200px) + 40px)" }}>
              <div className="max-w-md text-center">
                <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Nothing is blocked</h1>
                <p className="mt-2 text-muted">
                  {empty
                    ? "Blocked work shows up here once people start capturing."
                    : `${stars.filter((star) => star.status === "at_risk").length} projects are at risk. Ask Orion what's slipping, or open Context to see how work connects.`}
                </p>
                {!empty && (
                  <button
                    type="button"
                    onClick={() => navigate("context")}
                    className="mt-4 rounded-md border border-line-strong px-3 py-1.5 text-[13px] text-ink transition-colors hover:bg-raised"
                  >
                    Open Context
                  </button>
                )}
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
                stale={connection !== "live"}
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
        </main>

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
              onRetry={(text) => sendFromMap(text, { retry: true })}
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
