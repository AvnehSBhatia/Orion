"use client";

// First run for an org with nothing captured yet: what to set up, in order, with progress.
// Each step checks itself off from live data, so the list shrinks as the org comes to life.

import { useSession } from "@/components/auth/session";
import { api } from "@/lib/api/client";
import type { ActivityResponse, OrgSummary, User } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { Check, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

type Step = { id: string; title: string; body: React.ReactNode; done: boolean; href?: string; action?: string; adminOnly?: boolean };

export function Onboarding({ org, users, activity }: { org: OrgSummary | null; users: User[]; activity: ActivityResponse | null }) {
  const { me } = useSession();
  const [hasToken, setHasToken] = useState(false);
  useEffect(() => {
    let alive = true;
    api.tokens
      .list()
      .then(({ tokens }) => alive && setHasToken(tokens.some((t) => t.kind === "api")))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const sources = activity?.sources ?? [];
  const steps: Step[] = [
    {
      id: "mac",
      title: "Install Orion on your Mac and connect it",
      body: "One Terminal command installs it. Each person turns on the apps Orion may read and approves what it sends; work shows up here within minutes.",
      done: (activity?.counts.sources ?? 0) > 0,
      href: "/download",
      action: "Get the Mac app",
    },
    {
      id: "invite",
      title: "Invite your teammates",
      body: "Send each person a one-time invite link. They pick their own username and password.",
      done: users.length > 1,
      href: "/admin#people",
      action: "Invite people",
      adminOnly: true,
    },
    {
      id: "claude",
      title: "Connect Claude Code",
      body: "Create a token and paste one command, so your coding agent can pull this context into every task.",
      done: hasToken,
      href: "/settings#claude-code",
      action: "Connect",
    },
    {
      id: "ci",
      title: "Connect GitHub",
      body: "Create a token for a repo and commit the workflow Orion shows you. Every push then turns commits into plain-English updates.",
      done: sources.some((s) => s.kind === "code"),
      href: "/settings#github",
      action: "Connect",
      adminOnly: true,
    },
    {
      id: "profile",
      title: "Describe your company",
      body: "One paragraph on what you build. Orion reads it to sort captures into the right projects.",
      done: !!org && !!org.description && org.description !== org.id,
      href: "/admin#profile",
      action: "Edit profile",
      adminOnly: true,
    },
  ].filter((step) => !step.adminOnly || me.admin || me.authDisabled);

  const done = steps.filter((s) => s.done).length;

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-8 md:px-8 md:py-12" aria-labelledby="onboarding-title">
      <p className="font-mono text-[11px] tracking-[0.12em] text-faint uppercase">Getting started</p>
      <h1 id="onboarding-title" className="mt-2 text-[28px] font-semibold tracking-[-0.03em]">
        Set up {org?.name ?? "your org"}
      </h1>
      <p className="mt-2 max-w-xl text-muted">
        Nothing has been captured yet. Once people install the Mac app, their work shows up here as projects, owners, and what
        changed.
      </p>
      <div className="mt-6 flex items-center gap-3" aria-label={`${done} of ${steps.length} steps done`}>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-raised">
          <div className="h-full rounded-full bg-ink transition-[width] duration-500" style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
        <span className="font-mono text-[12px] text-faint tabular-nums">
          {done}/{steps.length}
        </span>
      </div>
      <ol className="mt-6 space-y-3">
        {steps.map((step, index) => (
          <li key={step.id} className={cn("flex gap-4 rounded-2xl border border-line bg-panel p-4 md:p-5", step.done && "opacity-70")}>
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-[12px]",
                step.done ? "border-ink bg-ink text-bg" : "border-line-strong text-muted",
              )}
              aria-hidden
            >
              {step.done ? <Check className="size-3.5" /> : index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[15px] font-medium">
                {step.title}
                {step.done && <span className="sr-only"> (done)</span>}
              </h2>
              <p className="mt-1 text-[14px] leading-relaxed text-muted">{step.body}</p>
              {step.href && !step.done && (
                <Link
                  href={step.href}
                  target={step.href.startsWith("http") ? "_blank" : undefined}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-line-strong px-3 py-1.5 text-[13px] text-ink transition-colors hover:bg-raised"
                >
                  {step.action}
                  <ArrowUpRight className="size-3.5" />
                </Link>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
