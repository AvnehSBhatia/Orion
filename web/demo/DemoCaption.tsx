"use client";

// Demo mode's one piece of chrome: the current step as a quiet line under the header.
// Doubles as the presenter's script. Shift+H hides it.

import { useDemo } from "./state";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";

export function DemoCaption({ intro }: { intro: boolean }) {
  const demo = useDemo();
  if (!demo.on || !demo.step) return null;
  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4 transition-[top] duration-500",
        intro ? "top-5" : "top-[68px]",
      )}
      aria-live="polite"
    >
      <AnimatePresence mode="wait" initial={false}>
        {!demo.hidden && (
          <motion.p
            key={demo.index}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="max-w-[min(820px,100%)] truncate rounded-full border border-line bg-black/70 px-4 py-1.5 text-[13px] text-muted backdrop-blur-md"
          >
            <span className="font-mono text-[12px] text-faint tabular-nums">{demo.index + 1}</span>
            <span className="text-faint"> · </span>
            <span className="text-ink">{demo.step.title}</span>
            <span className="text-faint">: </span>
            {demo.step.caption}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
