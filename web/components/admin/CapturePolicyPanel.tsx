"use client";

import { field, Notice, Panel, PrimaryButton, SecondaryButton } from "@/components/ui/form";
import { api } from "@/lib/api/client";
import type { OrgSettings } from "@/lib/api/types";
import { settingsError } from "@/lib/notLive";
import { type FormEvent, useEffect, useState } from "react";

type Draft = Omit<OrgSettings, "excludedHosts"> & { excludedHosts: string };

const toDraft = (s: OrgSettings): Draft => ({ ...s, excludedHosts: s.excludedHosts.join("\n") });

/** "https://www.Mail.google.com/inbox" → "mail.google.com". Blank and invalid lines are dropped. */
function hosts(text: string) {
  const out = new Set<string>();
  for (const raw of text.split(/[\n,]+/)) {
    const line = raw.trim().toLowerCase();
    if (!line) continue;
    let host = line;
    try {
      host = new URL(/^[a-z]+:\/\//.test(line) ? line : `https://${line}`).hostname;
    } catch {
      continue;
    }
    out.add(host.replace(/^www\./, ""));
  }
  return [...out];
}

export function CapturePolicyPanel({ orgId }: { orgId: string }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<OrgSettings | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api.orgs
      .settings(orgId)
      .then(({ settings }) => {
        if (!alive) return;
        setSaved(settings);
        setDraft(toDraft(settings));
      })
      .catch((err) => alive && setMsg({ kind: "error", text: settingsError(err, "read the capture policy") }));
    return () => {
      alive = false;
    };
  }, [orgId]);

  const save = async (change: Partial<OrgSettings>, done = "Saved. Extensions pick this up within a few minutes.") => {
    setBusy(true);
    setMsg(null);
    try {
      const { settings } = await api.orgs.saveSettings(orgId, change);
      setSaved(settings);
      setDraft(toDraft(settings));
      setMsg({ kind: "ok", text: done });
    } catch (err) {
      setMsg({ kind: "error", text: settingsError(err, "change the capture policy") });
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    const num = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(v) || 0)));
    void save({
      captureEnabled: draft.captureEnabled,
      excludedHosts: hosts(draft.excludedHosts),
      captureIntervalSec: num(draft.captureIntervalSec, 1, 3600),
      retentionDays: num(draft.retentionDays, 0, 3650),
      screenshotRetentionDays: num(draft.screenshotRetentionDays, 0, 3650),
      screenshotVisibility: draft.screenshotVisibility,
      llmMonthlyBudgetUsd: Math.max(0, Number(draft.llmMonthlyBudgetUsd) || 0),
    });
  };

  if (!draft) {
    return (
      <Panel title="Capture policy">
        {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : <div className="h-48 animate-pulse rounded-lg bg-raised" aria-label="Loading policy" />}
      </Panel>
    );
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft({ ...draft, [key]: value });
  const label = "block text-sm text-muted";
  const help = "mt-1 block text-[12px] text-faint";

  return (
    <>
      <Panel title="Capture policy" description="What the extension may record for everyone in your org, how long Orion keeps it, and what it may spend.">
        <form onSubmit={submit} className="grid gap-5">
          <label className="flex items-start gap-3 rounded-lg border border-line bg-bg p-3 text-[14px]">
            <input
              type="checkbox"
              checked={draft.captureEnabled}
              onChange={(e) => set("captureEnabled", e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-[#ededed]"
            />
            <span>
              <span className="text-ink">Capture is on</span>
              <span className={help}>Turn this off to stop every extension in the org from recording.</span>
            </span>
          </label>

          <label className={label}>
            Never capture these sites
            <textarea
              className={`${field} h-28 py-2 font-mono text-[13px]`}
              value={draft.excludedHosts}
              onChange={(e) => set("excludedHosts", e.target.value)}
              placeholder={"mail.google.com\nbank.example.com"}
              spellCheck={false}
            />
            <span className={help}>One host per line. Subdomains are included. Good defaults: webmail, banking, health, HR, password managers.</span>
          </label>

          <div className="grid gap-5 sm:grid-cols-3">
            <label className={label}>
              Seconds between captures
              <input className={field} type="number" min={1} max={3600} value={draft.captureIntervalSec} onChange={(e) => set("captureIntervalSec", Number(e.target.value))} />
            </label>
            <label className={label}>
              Keep page text (days)
              <input className={field} type="number" min={0} value={draft.retentionDays} onChange={(e) => set("retentionDays", Number(e.target.value))} />
              <span className={help}>0 keeps it forever.</span>
            </label>
            <label className={label}>
              Keep screenshots (days)
              <input className={field} type="number" min={0} value={draft.screenshotRetentionDays} onChange={(e) => set("screenshotRetentionDays", Number(e.target.value))} />
            </label>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <label className={label}>
              Who can see a colleague&apos;s screenshots
              <select
                className={field}
                value={draft.screenshotVisibility}
                onChange={(e) => set("screenshotVisibility", e.target.value as OrgSettings["screenshotVisibility"])}
              >
                <option value="author_and_admins">Only the person who captured it, and admins</option>
                <option value="org">Everyone in the org</option>
              </select>
              <span className={help}>Page text and work items are always visible to the whole org.</span>
            </label>
            <label className={label}>
              Monthly AI budget (USD)
              <input className={field} type="number" min={0} step="1" value={draft.llmMonthlyBudgetUsd} onChange={(e) => set("llmMonthlyBudgetUsd", Number(e.target.value))} />
              <span className={help}>Once reached, chat and dashboard requests pause until next month. 0 means no cap.</span>
            </label>
          </div>

          {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
          <div>
            <PrimaryButton type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save policy"}
            </PrimaryButton>
          </div>
        </form>
      </Panel>

      <Panel
        title="Monitoring notice"
        description="Everyone accepts the notice before capture starts. After you change what's recorded or who sees it, ask everyone to accept again."
      >
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[14px] text-muted">Current version: {saved?.consentVersion ?? draft.consentVersion}</p>
          <SecondaryButton
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm("Ask everyone to read and accept the notice again? Capture pauses for each person until they do."))
                void save({ consentVersion: (saved?.consentVersion ?? draft.consentVersion) + 1 }, "Everyone will be asked to accept the notice again.");
            }}
          >
            Ask everyone to accept again
          </SecondaryButton>
        </div>
      </Panel>
    </>
  );
}
