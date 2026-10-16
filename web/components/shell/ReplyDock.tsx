"use client";

import { ActionPills } from "@/components/chat/ActionPills";
import { ReplyText } from "@/components/chat/ReplyText";
import { type Message, plainQuestion } from "@/lib/chat";
import { CircleAlert, RotateCw, Square, X } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * The answer above the composer, kept out of the way: the latest reply only, a few lines tall. A few seconds after it
 * finishes it folds into a one-line pill; hovering or clicking opens it again, and earlier turns sit behind "Earlier".
 */
export function ReplyDock({
  question,
  messages,
  onSend,
  onClose,
  onRetry,
  onStop,
  keepOpen = false,
}: {
  question: string;
  messages: Message[];
  onSend: (text: string) => void;
  onClose: () => void;
  /** Sends a failed question again. */
  onRetry: (question: string) => void;
  /** Cancels the answer being written. */
  onStop?: () => void;
  /** Demo mode: the answer stays up while the presenter talks over it. */
  keepOpen?: boolean;
}) {
  const last = messages.at(-1)!;
  const [folded, setFolded] = useState(false);
  const [hover, setHover] = useState(false);
  const [history, setHistory] = useState(false);
  // A new message unfolds the dock and closes the history (adjusted during render, not in an effect).
  const [seenCount, setSeenCount] = useState(messages.length);
  if (seenCount !== messages.length) {
    setSeenCount(messages.length);
    setFolded(false);
    setHistory(false);
  }
  useEffect(() => {
    if (keepOpen || last.pending || last.failed || hover || history) return;
    const t = window.setTimeout(() => setFolded(true), 7000);
    return () => window.clearTimeout(t);
  }, [keepOpen, last.pending, last.failed, last.text, hover, history]);
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
          {last.pending && onStop && (
            <button
              type="button"
              onClick={onStop}
              className="flex items-center gap-1 rounded-full px-1.5 text-[11px] text-faint hover:text-ink"
            >
              <Square className="size-2.5 fill-current" />
              Stop
            </button>
          )}
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
      {last.failed ? (
        <div role="alert" className="mt-1 flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-[13px] leading-snug text-[#d4d4d4]">
            <CircleAlert className="size-3.5 shrink-0 text-muted" />
            {last.text}
          </p>
          <button
            type="button"
            onClick={() => onRetry(last.failed!.question)}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-line-strong px-2.5 py-1 text-[12px] text-ink transition-colors hover:bg-raised"
          >
            <RotateCw className="size-3" />
            Retry
          </button>
        </div>
      ) : (
      <div className="thin-scroll mt-0.5 max-h-24 overflow-auto pr-1">
        <ReplyText
          text={last.text}
          sources={last.sources}
          streaming={last.pending}
          className="text-[13px] leading-snug text-[#d4d4d4]"
        />
      </div>
      )}
      {!last.pending && !last.failed && <ActionPills actions={last.actions} onSend={onSend} className="mt-1.5" />}
    </div>
  );
}
