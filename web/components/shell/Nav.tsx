"use client";

import { RandomLetterSwap } from "@/components/ui/random-letter-swap";
import { cn } from "@/lib/utils";
import { Menu, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type View = "home" | "map" | "context" | "blocked";

export const VIEWS: { id: View; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "map", label: "Map" },
  { id: "context", label: "Context" },
  { id: "blocked", label: "Blocked" },
];

/** The header nav from 640px up: real buttons, the current one marked for assistive tech. */
export function Nav({ view, onNavigate, onAsk }: { view: View; onNavigate: (view: View) => void; onAsk: () => void }) {
  return (
    <nav aria-label="Main" className="flex items-center gap-8 max-md:gap-4 max-sm:hidden">
      {VIEWS.map((item) => (
        <RandomLetterSwap
          key={item.id}
          label={item.label}
          aria-current={view === item.id ? "page" : undefined}
          onClick={() => onNavigate(item.id)}
          className={cn("text-sm font-medium transition-colors hover:text-ink", view === item.id ? "text-ink" : "text-muted")}
        />
      ))}
      <RandomLetterSwap label="Ask" onClick={onAsk} className="text-sm font-medium text-muted transition-colors hover:text-ink" />
    </nav>
  );
}

type MenuLink = { label: string; href: string };

/** Below 640px: a menu button that opens a sheet with the views and account links. */
export function MobileMenu({
  view,
  onNavigate,
  onAsk,
  links,
  onSignOut,
  who,
}: {
  view: View;
  onNavigate: (view: View) => void;
  onAsk: () => void;
  links: MenuLink[];
  onSignOut?: () => void;
  who?: string;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    sheetRef.current?.querySelector<HTMLElement>("button, a")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const go = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  const item = "flex w-full items-center rounded-lg px-3 py-3 text-left text-[16px] transition-colors hover:bg-raised";

  return (
    <div className="sm:hidden">
      <button
        ref={buttonRef}
        type="button"
        aria-label="Menu"
        aria-expanded={open}
        aria-controls="mobile-menu"
        onClick={() => setOpen((v) => !v)}
        className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-panel hover:text-ink"
      >
        {open ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>
      {/* Portaled: the header is its own stacking context, and the sheet must cover the chat dock. */}
      {typeof document !== "undefined" &&
        createPortal(
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="scrim"
              className="fixed inset-0 top-14 z-[80] bg-black/60"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              aria-hidden
            />
            <motion.div
              key="sheet"
              id="mobile-menu"
              ref={sheetRef}
              role="dialog"
              aria-label="Menu"
              initial={{ y: -8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -8, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="fixed inset-x-0 top-14 z-[90] border-b border-line-strong bg-panel px-3 pt-2 pb-4 shadow-[0_24px_48px_rgba(0,0,0,0.6)]"
            >
              <nav aria-label="Main">
                {VIEWS.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    aria-current={view === v.id ? "page" : undefined}
                    onClick={go(() => onNavigate(v.id))}
                    className={cn(item, view === v.id ? "text-ink" : "text-muted")}
                  >
                    {v.label}
                  </button>
                ))}
                <button type="button" onClick={go(onAsk)} className={cn(item, "text-muted")}>
                  Ask
                </button>
              </nav>
              <div className="mt-2 border-t border-line pt-2">
                {who && <p className="px-3 py-2 text-[13px] text-faint">{who}</p>}
                {links.map((link) => (
                  <Link key={link.href} href={link.href} className={cn(item, "text-muted")} onClick={() => setOpen(false)}>
                    {link.label}
                  </Link>
                ))}
                {onSignOut && (
                  <button type="button" onClick={go(onSignOut)} className={cn(item, "text-muted")}>
                    Sign out
                  </button>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}
