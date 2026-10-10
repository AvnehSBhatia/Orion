"use client";

import RuixenMoonChat from "@/components/ui/ruixen-moon-chat";
import { type Message, SUGGESTIONS } from "@/lib/stars";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";

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

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  return (
    <aside className={cn("relative z-50 flex min-h-0 flex-col bg-bg", className)} aria-label="Ask Orion">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-5">
        <Sparkles className="size-4 text-muted" strokeWidth={1.75} />
        <h2 className="text-[14px] font-medium">Ask Orion</h2>
      </div>
      <div className="thin-scroll min-h-0 flex-1 space-y-4 overflow-auto px-5 py-5" aria-live="polite">
        {messages.length === 0 && (
          <p className="text-[14px] text-muted">Ask about a chart, a date, or a project on this page.</p>
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
            <p key={index} className="max-w-[95%] text-[14px] leading-relaxed text-[#d4d4d4]">
              {message.text}
            </p>
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
              onClick={() => onSend(suggestion)}
              className="rounded-full border border-line-strong px-3 py-1 text-left text-[13px] text-muted transition-colors duration-150 hover:border-[#4a4a4a] hover:text-ink"
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
