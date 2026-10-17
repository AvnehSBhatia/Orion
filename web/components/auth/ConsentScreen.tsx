"use client";

// First run when the org requires it: the monitoring notice, and an explicit acknowledgement before anything else.

import { Centered } from "@/components/auth/Centered";
import { useSession } from "@/components/auth/session";
import { Logo } from "@/components/ui/Logo";
import { api } from "@/lib/api/client";
import { friendlyError } from "@/lib/errors";
import { Markdown } from "@/lib/markdown";
import Link from "next/link";
import { useState } from "react";

const FALLBACK_NOTICE = `**Your organization uses Orion to keep a shared, up-to-date picture of the team's work.** Please read this before you start.

**What's recorded.** Only the browser tabs, windows or screens you pick in the Orion extension, and only while recording is on: the page address, title and visible text (never passwords), and screenshots when the content changes.

**What it's used for.** Orion turns that into work items (projects, blockers, who's on what) your team can see, search, and ask about. Page text is processed by AI models to do this.

**Who sees it.** Colleagues see work items and page text. Screenshots are visible to you and your org's admins unless your admin changed that.

**Your controls.** Pause or stop recording at any time from the Orion icon, remove a tab from what's shared, and ask your admin to see or delete your data.`;

export function ConsentScreen() {
  const { me, refresh, signOut } = useSession();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const consent = me.consent!;

  const accept = async () => {
    setBusy(true);
    setError("");
    try {
      await api.auth.consent(consent.version);
      await refresh();
    } catch (err) {
      setError(friendlyError(err, "accept the notice"));
      setBusy(false);
    }
  };

  return (
    <Centered wide>
      <Logo size={24} />
      <p className="mt-6 font-mono text-[11px] tracking-[0.12em] text-faint uppercase">Monitoring notice · version {consent.version}</p>
      <h1 className="mt-2 text-[26px] font-semibold tracking-[-0.03em]">Before you start: what Orion records</h1>
      <div className="thin-scroll mt-4 max-h-[52dvh] overflow-auto rounded-2xl border border-line bg-panel px-5 py-2 text-[14px] text-muted">
        <Markdown source={consent.notice?.trim() || FALLBACK_NOTICE} />
      </div>
      <label className="mt-5 flex items-start gap-3 text-[14px] text-ink">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[#ededed]"
        />
        I&apos;ve read this notice and understand what Orion records.
      </label>
      {error && (
        <p role="alert" className="mt-3 text-[14px] text-danger">
          {error}
        </p>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!checked || busy}
          onClick={accept}
          className="h-10 rounded-md bg-ink px-4 text-sm font-medium text-bg disabled:opacity-50"
        >
          {busy ? "Saving…" : "Accept and continue"}
        </button>
        <button type="button" onClick={() => void signOut()} className="h-10 rounded-md px-3 text-sm text-muted hover:text-ink">
          Not now, sign out
        </button>
        <Link href="/privacy" className="ml-auto text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline">
          Privacy policy
        </Link>
      </div>
    </Centered>
  );
}
