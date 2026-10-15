"use client";

import { useSession } from "@/components/auth/session";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export type AccountLink = { label: string; href: string };

/** Links in the account menu; admin links only for admins. */
export function accountLinks(admin: boolean | undefined): AccountLink[] {
  return [
    { label: "Settings", href: "/settings" },
    { label: "Connect Claude Code", href: "/settings#claude-code" },
    { label: "Change password", href: "/settings#password" },
    ...(admin ? [{ label: "Admin", href: "/admin" }] : []),
    { label: "Privacy", href: "/privacy" },
  ];
}

/** The signed-in person's menu in the header: who and where they are, settings, and sign out. */
export function AccountMenu({ name, orgName, className }: { name?: string | null; orgName?: string | null; className?: string }) {
  const { me, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const display = name || me.username || "You";

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (me.authDisabled) return null;
  const item = "block w-full rounded-lg px-2.5 py-2 text-left text-[14px] text-muted transition-colors hover:bg-raised hover:text-ink";

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${display}`}
        onClick={() => setOpen((v) => !v)}
        className="flex size-8 items-center justify-center rounded-full border border-line-strong bg-raised font-mono text-[11px] text-ink transition-colors hover:border-[#4a4a4a]"
      >
        {initials(display)}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="Account"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="absolute top-full right-0 z-50 mt-2 w-64 origin-top-right rounded-xl border border-line-strong bg-panel p-1.5 shadow-[0_16px_50px_rgba(0,0,0,0.6)]"
          >
            <div className="border-b border-line px-2.5 pt-1.5 pb-2.5">
              <p className="truncate text-[14px] text-ink">{display}</p>
              <p className="truncate text-[12px] text-faint">
                {[me.username && `@${me.username}`, orgName ?? me.orgId, me.admin ? "Admin" : null].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="py-1">
              {accountLinks(me.admin).map((link) => (
                <Link key={link.href} href={link.href} role="menuitem" className={item} onClick={() => setOpen(false)}>
                  {link.label}
                </Link>
              ))}
            </div>
            <div className="border-t border-line pt-1">
              <button type="button" role="menuitem" onClick={() => void signOut()} className={item}>
                Sign out
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
