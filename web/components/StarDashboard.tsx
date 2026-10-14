"use client";

import { ChatPanel } from "@/components/ChatPanel";
import { Donut, LineChart } from "@/components/Charts";
import { StatusMark } from "@/components/StatusMark";
import {
  activity,
  DOMAIN_LABEL,
  DOMAINS,
  type Lesson,
  type Message,
  percentChange,
  type Star,
  statusLabel,
} from "@/lib/stars";
import { cn } from "@/lib/utils";
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  CircleAlert,
  ListChecks,
  Map as MapIcon,
  Search,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type View = "map" | "context" | "blocked";

export function StarDashboard({
  star,
  stars,
  messages,
  onSend,
  onAnswer,
  onSelect,
  onNavigate,
}: {
  star: Star;
  /** Every project, for the sidebar and for questions that name another one. */
  stars: Star[];
  messages: Message[];
  onSend: (message: string) => void;
  onAnswer: (message: string, reply: string) => void;
  onSelect: (id: string) => void;
  onNavigate: (view: View) => void;
}) {
  const [query, setQuery] = useState("");
  const [spot, setSpot] = useState<Lesson | null>(null);
  const [origin, setOrigin] = useState("50% 40%");
  const [zoomed, setZoomed] = useState(false);
  const [scale, setScale] = useState(1);
  const { updates, mentions } = activity(star);
  const open = star.tasks.active + star.tasks.blocked + star.tasks.todo;
  const total = open + star.tasks.done;
  const matches = stars.filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase()));
  const prompts = [
    `Why is this ${statusLabel(star.status).toLowerCase()}?`,
    "What should I do next?",
    "Explain the activity chart",
  ];

  useEffect(() => {
    setSpot(null);
    setZoomed(false);
  }, [star.id]);

  useEffect(() => {
    if (!spot) {
      setZoomed(false);
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frame = window.setTimeout(() => {
      const main = document.getElementById("project-sheet");
      const el = document.querySelector<HTMLElement>(`[data-spot="${spot.target}"]`);
      if (!main || !el) return;
      const box = el.getBoundingClientRect();
      if (!main.contains(el) || box.width < 2 || box.height < 2) return;
      const mainBox = main.getBoundingClientRect();
      const x = ((box.left + box.width / 2 - mainBox.left) / mainBox.width) * 100;
      const y = ((box.top + box.height / 2 - mainBox.top) / mainBox.height) * 100;
      setOrigin(`${Math.min(92, Math.max(8, x))}% ${Math.min(92, Math.max(8, y))}%`);
      const fit = Math.min((window.innerWidth - 96) / box.width, (window.innerHeight - 220) / box.height);
      setScale(Math.min(1.2, Math.max(1, fit)));
      if (!reduce) setZoomed(true);
    }, reduce ? 0 : 460);
    return () => window.clearTimeout(frame);
  }, [spot]);

  const clearSpot = useCallback(() => setSpot(null), []);

  // Every question goes to Orion, scoped to the open project, so follow-ups get real answers with citations.
  const handleSend = (text: string) => onSend(`About "${star.label}": ${text}`);

  return (
    <div className="flex h-dvh bg-bg text-ink">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line lg:flex" aria-label="Projects">
        <div className="flex h-14 items-center gap-2.5 border-b border-line px-5">
          <Logo />
          <span className="text-[14px] font-semibold tracking-[-0.01em]">Orion</span>
        </div>
        <div className="p-3">
          <label className="flex items-center gap-2 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-[14px] focus-within:border-line-strong">
            <Search className="size-3.5 text-faint" />
            <span className="sr-only">Search projects</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="w-full bg-transparent placeholder:text-faint focus:outline-none"
            />
          </label>
        </div>
        <nav className="space-y-0.5 px-3 text-[14px]">
          <SideLink icon={MapIcon} label="Map" onClick={() => onNavigate("map")} />
          <SideLink icon={ListChecks} label="Context" onClick={() => onNavigate("context")} />
          <SideLink icon={CircleAlert} label="Blocked" onClick={() => onNavigate("blocked")} />
        </nav>
        <div className="thin-scroll mt-5 min-h-0 flex-1 space-y-5 overflow-auto px-3 pb-6">
          {DOMAINS.map((domain) => {
            const items = matches.filter((item) => item.domain === domain);
            if (items.length === 0) return null;
            return (
              <div key={domain}>
                <p className="px-2.5 pb-1.5 font-mono text-[11px] tracking-[0.12em] text-faint uppercase">
                  {DOMAIN_LABEL[domain]}
                </p>
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    data-spot={`project-${item.id}`}
                    onClick={() => onSelect(item.id)}
                    aria-current={item.id === star.id ? "page" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[14px] transition-colors duration-150",
                      item.id === star.id ? "bg-raised text-ink" : "text-muted hover:bg-panel hover:text-ink",
                    )}
                  >
                    <StatusMark status={item.status} size={10} />
                    {item.label}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </aside>

      <div className="thin-scroll min-w-0 flex-1 overflow-auto">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-line bg-bg/90 px-4 backdrop-blur md:px-8">
          <button
            type="button"
            onClick={() => onNavigate("map")}
            className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[14px] text-muted transition-colors hover:text-ink"
          >
            <ArrowLeft className="size-4" />
            <span className="hidden sm:inline">Map</span>
          </button>
          <span className="text-line-strong">/</span>
          <span className="text-[14px] text-muted">{DOMAIN_LABEL[star.domain]}</span>
          <span className="text-line-strong">/</span>
          <span className="truncate text-[14px]">{star.label}</span>
        </header>

        <main
          id="project-sheet"
          className="mx-auto max-w-5xl space-y-5 px-4 py-6 md:px-8 md:py-8"
          style={{
            transform: zoomed ? `scale(${scale})` : undefined,
            transformOrigin: origin,
            transition: "transform 520ms cubic-bezier(0.23, 1, 0.32, 1)",
          }}
        >
          <section data-spot="summary" className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-[30px] font-semibold tracking-[-0.035em] md:text-[34px]">{star.label}</h1>
              <p className="mt-1 max-w-xl text-muted">{star.summary}</p>
            </div>
            <div className="flex items-center gap-3">
              <span data-spot="status" className="flex items-center gap-2 rounded-full border border-line-strong px-3 py-1 text-[13px]">
                <StatusMark status={star.status} size={10} />
                {statusLabel(star.status)}
              </span>
              <span data-spot="owner" className="flex items-center gap-2 text-[13px] text-muted">
                <span className="flex size-7 items-center justify-center rounded-full bg-raised font-mono text-[11px] text-ink">
                  {initials(star.owner)}
                </span>
                <span className="hidden sm:inline">{star.owner}</span>
              </span>
            </div>
          </section>

          <section className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-3">
            <Fact spot="todo" icon={ListChecks} title="What to do" body={star.todo ?? "Nothing for you right now."} />
            <Fact spot="read" icon={BookOpen} title="What to read" body={star.read} href={star.readUrl} />
            <Fact
              spot="sales"
              icon={star.sellable ? ShieldCheck : ShieldOff}
              title="Can sales mention it"
              body={star.sellable ? "Yes, this is public." : "Not yet. Keep this internal."}
            />
          </section>

          <section className="grid gap-5 lg:grid-cols-3">
            <Card spot="activity" className="lg:col-span-2" title="Activity" note="Last 8 weeks">
              <LineChart updates={updates} mentions={mentions} />
            </Card>
            <Card spot="tasks" title="Tasks by status" note={`${total} total`}>
              <Donut
                parts={[
                  { label: "Done", value: star.tasks.done, color: "#ededed" },
                  { label: "In progress", value: star.tasks.active, color: "#9a9a9a" },
                  { label: "Blocked", value: star.tasks.blocked, color: "#5a5a5a" },
                  { label: "Not started", value: star.tasks.todo, color: "#2e2e2e" },
                ]}
              />
            </Card>
          </section>

          <section className="grid grid-cols-2 gap-5 lg:grid-cols-4">
            <Stat spot="open" label="Open tasks" value={String(open)} detail={`${star.tasks.blocked} blocked`} />
            <Stat spot="updates-week" label="Updates this week" value={String(updates.at(-1))} change={percentChange(updates)} />
            <Stat spot="mentions" label="Mentions this week" value={String(mentions.at(-1))} change={percentChange(mentions)} />
            <Stat spot="due" label="Due" value={star.due} detail={`Updated ${star.updated}`} />
          </section>

          <Card spot="updates" title="Recent updates" note={`${star.updates.length} sources`} flush>
            {star.updates.length === 0 && (
              <p className="px-5 pb-5 text-[14px] text-muted">No captures or commits have touched this yet.</p>
            )}
            <div className={cn("overflow-x-auto", star.updates.length === 0 && "hidden")}>
              <table className="w-full min-w-[560px] text-left text-[14px]">
                <thead>
                  <tr className="border-b border-line font-mono text-[11px] tracking-[0.1em] text-faint uppercase">
                    <th className="px-5 py-2.5 font-normal">Date</th>
                    <th className="px-5 py-2.5 font-normal">Source</th>
                    <th className="px-5 py-2.5 font-normal">Change</th>
                    <th className="px-5 py-2.5 font-normal">Author</th>
                  </tr>
                </thead>
                <tbody>
                  {star.updates.map((update, index) => (
                    <tr
                      key={`${index}-${update.date}-${update.change}`}
                      data-spot={`update-${index}`}
                      className="border-b border-line transition-colors duration-150 last:border-0 hover:bg-panel"
                    >
                      <td className="px-5 py-3 font-mono text-[13px] whitespace-nowrap text-muted">{update.date}</td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <span className="rounded-md border border-line-strong px-2 py-0.5 text-[12px] text-muted">
                          {update.source}
                        </span>
                      </td>
                      <td className="px-5 py-3">{update.change}</td>
                      <td className="px-5 py-3 whitespace-nowrap text-muted">{update.author}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <ChatPanel
            messages={messages}
            onSend={handleSend}
            suggestions={prompts}
            className="h-[560px] overflow-hidden rounded-2xl border border-line xl:hidden"
          />
        </main>
      </div>

      <ChatPanel
        messages={messages}
        onSend={handleSend}
        suggestions={prompts}
        className="hidden w-[340px] shrink-0 border-l border-line xl:flex"
      />
      {spot && <Spotlight id={spot.target} title={spot.title} reply={spot.reply} onClose={clearSpot} />}
    </div>
  );
}

export function Logo() {
  return (
    <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden>
      <circle cx={9} cy={9} r={3} fill="#ededed" />
      <circle cx={9} cy={9} r={7.5} fill="none" stroke="#5a5a5a" />
      <circle cx={14.3} cy={3.7} r={1.4} fill="#ededed" />
    </svg>
  );
}

function SideLink({ icon: Icon, label, onClick }: { icon: typeof MapIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-muted transition-colors duration-150 hover:bg-panel hover:text-ink"
    >
      <Icon className="size-4" strokeWidth={1.75} />
      {label}
    </button>
  );
}

function Card({
  spot,
  title,
  note,
  className,
  flush,
  children,
}: {
  spot?: string;
  title: string;
  note?: string;
  className?: string;
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section data-spot={spot} className={cn("rounded-2xl border border-line bg-panel", className)}>
      <div className="flex items-baseline justify-between px-5 pt-4 pb-3">
        <h2 className="text-[14px] font-medium">{title}</h2>
        {note && <span className="font-mono text-[11px] tracking-wide text-faint uppercase">{note}</span>}
      </div>
      <div className={flush ? undefined : "px-5 pb-5"}>{children}</div>
    </section>
  );
}

function Fact({
  spot,
  icon: Icon,
  title,
  body,
  href,
}: {
  spot: string;
  icon: typeof MapIcon;
  title: string;
  body: string;
  href?: string;
}) {
  return (
    <div data-spot={spot} className="bg-panel p-5">
      <p className="flex items-center gap-2 font-mono text-[11px] tracking-[0.1em] text-faint uppercase">
        <Icon className="size-3.5" strokeWidth={1.75} />
        {title}
      </p>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="mt-2 block text-[15px] underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-ink"
        >
          {body}
        </a>
      ) : (
        <p className="mt-2 text-[15px]">{body}</p>
      )}
    </div>
  );
}

function Stat({
  spot,
  label,
  value,
  change,
  detail,
}: {
  spot: string;
  label: string;
  value: string;
  change?: number;
  detail?: string;
}) {
  return (
    <div data-spot={spot} className="rounded-2xl border border-line bg-panel p-5">
      <p className="text-[13px] text-muted">{label}</p>
      <p className="mt-2 text-[28px] font-semibold tracking-[-0.03em]">{value}</p>
      {change !== undefined ? (
        <p className="mt-1 flex items-center gap-1 text-[13px] text-muted">
          <span className="flex items-center gap-0.5 rounded-md border border-line-strong px-1.5 py-0.5 font-mono text-[12px] text-ink">
            {change > 0 && <ArrowUpRight className="size-3" />}
            {change < 0 && <ArrowDownRight className="size-3" />}
            {change > 0 ? "+" : ""}
            {change}%
          </span>
          <span className="hidden sm:inline">vs last week</span>
        </p>
      ) : (
        <p className="mt-1 text-[13px] text-faint">{detail}</p>
      )}
    </div>
  );
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
}

function Spotlight({
  id,
  title,
  reply,
  onClose,
}: {
  id: string;
  title: string;
  reply: string;
  onClose: () => void;
}) {
  const [box, setBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const calloutRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = () => document.querySelector<HTMLElement>(`[data-spot="${id}"]`);
    const el = node();
    if (!el || el.getBoundingClientRect().width < 2) {
      setBox(null);
      return;
    }
    const place = () => {
      const current = node();
      const scroller = current?.closest<HTMLElement>(".thin-scroll");
      if (!current || !scroller) return;
      const rect = current.getBoundingClientRect();
      const room = 176;
      const topLimit = 68;
      const desiredBottom = window.innerHeight - room;
      const delta =
        rect.height > desiredBottom - topLimit
          ? rect.top - topLimit
          : rect.top < topLimit
            ? rect.top - topLimit
            : rect.bottom > desiredBottom
              ? rect.bottom - desiredBottom
              : 0;
      if (delta) scroller.scrollTop += delta;
    };
    place();
    const measure = () => {
      const current = node();
      if (!current) return;
      const rect = current.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      setBox({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
    };
    measure();
    const watch = window.setInterval(measure, 40);
    const realign = window.setTimeout(place, 520);
    const stop = window.setTimeout(() => window.clearInterval(watch), 1400);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(stop);
      window.clearTimeout(realign);
      window.clearInterval(watch);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [id, onClose]);
  const pad = 8;
  const hole = box
    ? { left: box.left - pad, top: box.top - pad, width: box.width + pad * 2, height: box.height + pad * 2 }
    : null;
  const calloutWidth = Math.min(380, window.innerWidth - 32);
  const calloutLeft = hole ? Math.max(16, Math.min(hole.left, window.innerWidth - calloutWidth - 16)) : 16;
  const below = hole ? hole.top + hole.height + 12 : 0;
  const calloutTop = hole ? (below + 148 < window.innerHeight ? below : Math.max(72, hole.top - 160)) : undefined;

  return (
    <>
      {hole && (
      <svg
        className="pointer-events-none fixed inset-0 z-40 h-dvh w-dvw"
        viewBox={`0 0 ${window.innerWidth} ${window.innerHeight}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <mask id="lesson-mask" maskUnits="userSpaceOnUse" x="0" y="0" width={window.innerWidth} height={window.innerHeight}>
            <rect width={window.innerWidth} height={window.innerHeight} fill="white" />
            <rect x={hole.left} y={hole.top} width={hole.width} height={hole.height} rx="18" fill="black" />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.72)" mask="url(#lesson-mask)" />
        <rect x={hole.left} y={hole.top} width={hole.width} height={hole.height} rx="18" fill="none" stroke="white" strokeWidth="1.5" />
      </svg>
      )}
      <div
        ref={calloutRef}
        className="fixed z-50 rounded-2xl border border-white/85 bg-black px-4 py-3 shadow-[0_16px_50px_rgba(0,0,0,0.45)]"
        style={{ top: calloutTop, bottom: calloutTop === undefined ? 16 : undefined, left: calloutLeft, width: calloutWidth }}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] font-medium tracking-[0.04em] text-white">{title}</p>
          <button type="button" onClick={onClose} className="shrink-0 text-[12px] text-muted hover:text-ink">
            Close
          </button>
        </div>
        <p className="mt-1.5 text-[14px] leading-relaxed text-[#d6d6d6]">{reply}</p>
      </div>
    </>
  );
}
