"use client";

import { cn } from "@/lib/utils";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

/** Copies `text` and confirms for a moment; the label says what is copied for screen readers. */
export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      window.setTimeout(() => setDone(false), 1600);
    } catch {
      // Clipboard blocked: the text is selectable on screen.
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={done ? "Copied" : label}
      className={cn(
        "flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-[12px] text-ink transition-colors hover:bg-raised",
        className,
      )}
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      <span aria-hidden>{done ? "Copied" : "Copy"}</span>
    </button>
  );
}

/** A one-line command or link with a copy button. */
export function CopyField({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-line bg-bg p-2">
      <code className="min-w-0 flex-1 px-1.5 py-1 font-mono text-[12.5px] leading-relaxed break-all text-ink select-all">{value}</code>
      <CopyButton text={value} label={label} />
    </div>
  );
}
