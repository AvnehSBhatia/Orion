"use client";

import { cn } from "@/lib/utils";
import { Check, ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

export type PickerOption = { id: string; title: string; detail?: string };

export function Picker({
  label,
  current,
  value,
  options,
  onPick,
  align = "left",
}: {
  label: string;
  current: string;
  value: string | null;
  options: PickerOption[];
  onPick: (id: string) => void;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current}`}
        onClick={() => setOpen((value) => !value)}
        className="flex max-w-[22ch] min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[14px] text-muted transition-colors hover:bg-panel hover:text-ink"
      >
        <span className="truncate">{current}</span>
        <ChevronDown className={cn("size-3.5 shrink-0 transition-transform duration-200", open && "rotate-180")} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="listbox"
            aria-label={label}
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "thin-scroll absolute top-full z-50 mt-2 max-h-[60vh] w-72 overflow-auto rounded-xl border border-line-strong bg-panel p-1.5 shadow-[0_16px_50px_rgba(0,0,0,0.6)]",
              align === "right" ? "right-0 origin-top-right" : "left-0 origin-top-left",
            )}
          >
            <p className="px-2.5 pt-1.5 pb-1 font-mono text-[11px] tracking-[0.12em] text-faint uppercase">{label}</p>
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={option.id === value}
                onClick={() => {
                  onPick(option.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 hover:bg-raised",
                  option.id === value && "bg-raised",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-ink">{option.title}</span>
                  {option.detail && <span className="line-clamp-2 text-[12px] leading-snug text-faint">{option.detail}</span>}
                </span>
                {option.id === value && <Check className="mt-0.5 size-3.5 shrink-0 text-ink" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
