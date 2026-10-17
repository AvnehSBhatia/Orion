"use client";

// The frame for full pages outside the dashboard (settings, admin): header with the way back, a section nav, content.

import { AccountMenu } from "@/components/shell/AccountMenu";
import { Logo } from "@/components/ui/Logo";
import { cn } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export type Section = { id: string; label: string };

export function PageFrame({
  title,
  description,
  sections,
  current,
  onSection,
  children,
}: {
  title: string;
  description?: string;
  sections?: Section[];
  /** With `onSection`, sections are tabs; without, they are in-page anchors. */
  current?: string;
  onSection?: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-bg text-ink">
      <a href="#main" className="sr-only z-[70] rounded-md bg-ink px-3 py-2 text-[13px] text-bg focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-bg/90 px-4 backdrop-blur md:px-6">
        <Link href="/" className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[14px] text-muted transition-colors hover:text-ink">
          <ArrowLeft className="size-4" />
          <span className="max-sm:sr-only">Dashboard</span>
        </Link>
        <span className="text-line-strong">/</span>
        <span className="flex items-center gap-2 text-[14px]">
          <Logo />
          {title}
        </span>
        <AccountMenu className="ml-auto" />
      </header>
      <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-6 md:grid-cols-[200px_minmax(0,1fr)] md:px-8 md:py-10">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.03em]">{title}</h1>
          {description && <p className="mt-1 text-[14px] text-muted">{description}</p>}
          {sections && sections.length > 0 && (
            <nav aria-label={`${title} sections`} className="mt-5 flex gap-1 overflow-x-auto md:flex-col [scrollbar-width:none]">
              {sections.map((s) =>
                onSection ? (
                  <button
                    key={s.id}
                    type="button"
                    aria-current={current === s.id ? "page" : undefined}
                    onClick={() => onSection(s.id)}
                    className={cn(
                      "shrink-0 rounded-lg px-3 py-2 text-left text-[14px] transition-colors",
                      current === s.id ? "bg-raised text-ink" : "text-muted hover:bg-panel hover:text-ink",
                    )}
                  >
                    {s.label}
                  </button>
                ) : (
                  <a key={s.id} href={`#${s.id}`} className="shrink-0 rounded-lg px-3 py-2 text-[14px] text-muted transition-colors hover:bg-panel hover:text-ink">
                    {s.label}
                  </a>
                ),
              )}
            </nav>
          )}
        </div>
        <main id="main" className="min-w-0 space-y-5">
          {children}
        </main>
      </div>
    </div>
  );
}
