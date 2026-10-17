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

// Shown only when the server sends no notice. A short form of docs/legal/employee-monitoring-notice.md; keep them in line.
const FALLBACK_NOTICE = `**Your organization uses Orion to keep a shared, current picture of the team's work and to draft your daily time entries.** Please read this before you start. Nothing is sent to Orion until you accept this notice.

**What the Orion Mac app reads.** Text on screen in the front window of the apps you turn on (every app starts off). In browsers, the tab title and the page's domain and path, and page text only if your organization allows it and you turn it on. Orion never takes screenshots or records keystrokes, and it skips private windows and password fields.

**Cleaned on your Mac first.** Card numbers, Social Security numbers, and API keys and tokens are always removed before anything is saved. Email addresses, phone numbers and street addresses are removed unless you turn that off.

**The Outbox.** Captured items wait on your Mac, where you can edit or delete them. Items you don't review are approved and sent after 30 minutes, unless you turn auto-approve off.

**What it's used for.** AI models, through OpenRouter at providers that keep nothing, read approved work to find work items and to draft your daily time entries.

**Who sees it.** Everyone in your organization sees the work items. The text from your Mac is visible only to you and your Orion admins. Admins can view Orion as you, and that is recorded. Admins can export the time entries you accept or edit.

**Your controls.** Pause or turn off capture at any time from the Orion menu bar icon. Delete your data or download a copy from Orion's settings. Ask your Orion admin to see, correct or delete your data.`;

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
