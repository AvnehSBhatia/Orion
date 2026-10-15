"use client";

import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { Toast } from "./useToasts";

export function Toasts({ toasts, reshaping = false, lower = false }: { toasts: Toast[]; reshaping?: boolean; lower?: boolean }) {
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
