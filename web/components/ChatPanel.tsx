"use client";

import RuixenMoonChat from "@/components/ui/ruixen-moon-chat";
import { sourceLabel } from "@/lib/live";
import type { ChatAction, Source } from "@/lib/orion";
import { openNode, openSource } from "@/lib/viewer";
import { type Message, SUGGESTIONS } from "@/lib/stars";
import { cn } from "@/lib/utils";
import { ArrowUpRight, LayoutGrid, MessageCircle, Sparkles } from "lucide-react";
import { Fragment, useEffect, useRef } from "react";

export function ChatPanel({
  messages,
  onSend,
  suggestions = SUGGESTIONS,
  className,
}: {
  messages: Message[];
  onSend: (message: string) => void;
  suggestions?: string[];
  className?: string;
}) {
  const end = useRef<HTMLDivElement>(null);
  const last = messages.at(-1);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, last?.pending, last?.text]);

  return (
    <aside className={cn("relative z-50 flex min-h-0 flex-col bg-bg", className)} aria-label="Ask Orion">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-5">
        <Sparkles className="size-4 text-muted" strokeWidth={1.75} />
        <h2 className="text-[14px] font-medium">Ask Orion</h2>
      </div>
      <div className="thin-scroll min-h-0 flex-1 space-y-4 overflow-auto px-5 py-5" aria-live="polite">
        {messages.length === 0 && (
          <p className="text-[14px] text-muted">Ask about any project, date, or chart.</p>
        )}
        {messages.map((message, index) =>
          message.role === "user" ? (
            <p
              key={index}
              className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-raised px-3.5 py-2 text-[14px]"
            >
              {message.text}
            </p>
          ) : (
            <div key={index} className="max-w-[95%] text-[13px] leading-relaxed text-[#d4d4d4]">
              <ReplyText text={message.text} sources={message.sources} streaming={message.pending} />
              {!message.pending && <ActionPills actions={message.actions} onSend={onSend} className="mt-2" />}
            </div>
          ),
        )}
        <div ref={end} />
      </div>
      <div className="shrink-0 space-y-3 border-t border-line p-4">
        <div className="flex flex-wrap gap-2">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={last?.pending}
              onClick={() => onSend(suggestion)}
              className="rounded-full border border-line-strong px-3 py-1 text-left text-[13px] text-muted transition-colors duration-150 hover:border-[#4a4a4a] hover:text-ink disabled:opacity-40"
            >
              {suggestion}
            </button>
          ))}
        </div>
        <RuixenMoonChat onSend={onSend} placeholder="Ask a follow-up" />
      </div>
    </aside>
  );
}

// [1], [S2], [1, 2] and [S1, S3] all count as citations.
const CITE = /\[\s*S?\d+(?:\s*,\s*S?\d+)*\s*\]/g;

/** A reply with its citations turned into small numbered chips; each opens the cited document so every claim can be checked. */
export function ReplyText({
  text,
  sources = [],
  streaming = false,
  className,
}: {
  text: string;
  sources?: Source[];
  /** Still arriving: a caret marks where the next token lands. */
  streaming?: boolean;
  className?: string;
}) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(CITE)) {
    const cited = [...match[0].matchAll(/\d+/g)]
      .map((m) => Number(m[0]))
      .filter((n) => sources[n - 1]);
    parts.push(text.slice(cursor, match.index).replace(/\s+$/, cited.length ? " " : ""));
    for (const n of cited) parts.push(<Cite key={`${match.index}-${n}`} n={n} source={sources[n - 1]} />);
    cursor = match.index + match[0].length;
  }
  parts.push(text.slice(cursor));
  return (
    <p className={cn("whitespace-pre-line", className)}>
      {parts.map((part, index) => (
        <Fragment key={index}>{part}</Fragment>
      ))}
      {streaming && <Caret />}
    </p>
  );
}

function Cite({ n, source }: { n: number; source: Source }) {
  const label = `${source.title || sourceLabel(source)}${source.authorName ? `, ${source.authorName}` : ""}`;
  return (
    <button
      type="button"
      onClick={() => openSource(source.id)}
      title={label}
      aria-label={`Source ${n}: ${label}`}
      className="mx-0.5 inline-flex size-[18px] translate-y-[-2px] items-center justify-center rounded-full border border-line-strong align-middle font-mono text-[10px] text-ink transition-colors hover:border-white hover:bg-white hover:text-black"
    >
      {n}
    </button>
  );
}

/** Where the next token lands while a reply streams in. */
export function Caret() {
  return <span aria-hidden className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-ink" />;
}

const ACTION_ICON = { open: ArrowUpRight, ask: MessageCircle, show: LayoutGrid } as const;

/**
 * The reply's suggested next steps as small pills: open shows the document or node, ask sends the follow-up,
 * show sends a dashboard request (the send flow reshapes the dashboard for layout words like "show").
 */
export function ActionPills({
  actions = [],
  onSend,
  className,
}: {
  actions?: ChatAction[];
  onSend: (message: string) => void;
  className?: string;
}) {
  if (!actions.length) return null;
  const run = (action: ChatAction) => {
    if (action.kind === "open") return action.target === "node" ? openNode(action.value) : openSource(action.value);
    if (action.kind === "show") return onSend(/^show\b/i.test(action.value) ? action.value : `Show ${action.value}`);
    onSend(action.value);
  };
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {actions.map((action) => {
        const Icon = ACTION_ICON[action.kind];
        return (
          <button
            key={`${action.kind}:${action.value}`}
            type="button"
            onClick={() => run(action)}
            title={action.kind === "open" ? undefined : action.value}
            className="flex items-center gap-1 rounded-full border border-line-strong px-2.5 py-0.5 text-[12px] text-muted transition-colors duration-150 hover:border-[#4a4a4a] hover:text-ink"
          >
            <Icon className="size-3" strokeWidth={1.75} />
            {action.label}
          </button>
        );
      })}
    </div>
  );
}
