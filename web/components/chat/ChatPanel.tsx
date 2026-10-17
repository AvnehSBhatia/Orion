"use client";

import { ActionPills } from "@/components/chat/ActionPills";
import { ReplyText } from "@/components/chat/ReplyText";
import RuixenMoonChat from "@/components/ui/ruixen-moon-chat";
import type { Message } from "@/lib/chat";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";

export function ChatPanel({
  messages,
  onSend,
  onRetry,
  onStop,
  suggestions = [],
  className,
}: {
  messages: Message[];
  onSend: (message: string) => void;
  /** Sends a failed question again; defaults to onSend. */
  onRetry?: (message: string) => void;
  /** Cancels the answer being written. */
  onStop?: () => void;
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
              {message.failed ? (
                <div role="alert">
                  <p>{message.text}</p>
                  <button
                    type="button"
                    onClick={() => (onRetry ?? onSend)(message.failed!.question)}
                    className="mt-2 rounded-full border border-line-strong px-3 py-1 text-[12px] text-ink transition-colors hover:bg-raised"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <ReplyText text={message.text} sources={message.sources} streaming={message.pending} />
              )}
              {message.pending && onStop && (
                <button
                  type="button"
                  onClick={onStop}
                  className="mt-2 rounded-full border border-line-strong px-3 py-1 text-[12px] text-muted transition-colors hover:bg-raised hover:text-ink"
                >
                  Stop
                </button>
              )}
              {!message.pending && !message.failed && <ActionPills actions={message.actions} onSend={onSend} className="mt-2" />}
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
