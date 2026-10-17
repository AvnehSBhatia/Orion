"use client";

// What left this account, who else looked, and what a manager can see. Counts and dates only.

import { PageFrame } from "@/components/settings/PageFrame";
import { Quiet } from "@/components/ui/Quiet";
import { api } from "@/lib/api/client";
import type { PrivacySummary } from "@/lib/api/types";
import { settingsError } from "@/lib/notLive";
import { ago } from "@/lib/time";
import Link from "next/link";
import { useEffect, useState } from "react";

const KIND: Record<string, string> = {
  capture: "Browser pages",
  code: "Commits",
  manual: "Added by hand",
  digest: "Digests",
  extension: "Browser pages",
};

const ACTION: Record<string, string> = {
  viewed_as: "Viewed Orion as you",
  source_opened: "Opened something you captured",
  data_exported: "Downloaded your data",
  data_deleted: "Deleted your data",
  account_updated: "Changed your account",
  password_reset: "Reset your password",
};

function eventLine(event: PrivacySummary["events"][number]) {
  if (event.action === "source_opened" && event.what === "screenshot") return "Opened a screenshot of yours";
  if (event.action === "source_opened") return "Opened text you captured";
  return ACTION[event.action] ?? "Did something with your account";
}

export function SharingPage() {
  const [data, setData] = useState<PrivacySummary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    api.me
      .privacy()
      .then((summary) => alive && setData(summary))
      .catch((err) => alive && setError(settingsError(err, "load what others can see")));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <PageFrame title="What others can see" description="Orion reads text in the apps you turn on. It does not take screenshots. This page is the line between you and everyone else.">
      {error && <p className="text-[14px] text-danger">{error}</p>}
      {!data && !error && <Quiet title="Loading…" />}
      {data && (
        <div className="grid gap-4">
          <section className="rounded-2xl border border-line bg-panel p-5 md:p-6">
            <h2 className="text-[16px] font-medium">Who sees what</h2>
            <ul className="mt-3 space-y-2 text-[14px] text-muted">
              <li>Everyone at your company sees the projects Orion builds: the name, the status, and a short summary.</li>
              <li>
                The text from your Mac is visible only to you
                {data.settings.screenshotVisibility === "org" ? " and, for older screenshots, anyone in the company." : " and your Orion admins."}
              </li>
              <li>An admin who views Orion as you, or opens your Mac text, is listed below. That list is kept {data.settings.auditRetentionDays} days.</li>
              <li>You choose the apps. Password managers cannot be turned on. Each item waits in the Outbox on your Mac until you approve it, or for 30 minutes if auto-approve is on.</li>
              {data.settings.macBrowserPageText ? (
                <li>Your company allows browser page text. It is read only if you turn that on yourself.</li>
              ) : (
                <li>Browsers send the tab title and the page address, cut to the domain and path. Page text stays off.</li>
              )}
            </ul>
          </section>

          <section className="rounded-2xl border border-line bg-panel p-5 md:p-6">
            <h2 className="text-[16px] font-medium">Sent in the last {data.windowDays} days</h2>
            <p className="mt-1 text-[14px] text-muted">{data.sent.total === 0 ? "Nothing in this window." : `${data.sent.total} items. Counts only, not the text.`}</p>
            {data.sent.total > 0 && (
              <ul className="mt-3 divide-y divide-line text-[14px]">
                {data.sent.macApps.map((row) => (
                  <li key={`mac-${row.app}`} className="flex justify-between gap-4 py-2">
                    <span>{row.app} on your Mac</span>
                    <span className="tabular-nums text-faint">{row.count}</span>
                  </li>
                ))}
                {data.sent.other.map((row) => (
                  <li key={row.kind} className="flex justify-between gap-4 py-2">
                    <span>{KIND[row.kind] ?? row.kind}</span>
                    <span className="tabular-nums text-faint">{row.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-line bg-panel p-5 md:p-6">
            <h2 className="text-[16px] font-medium">How long it stays</h2>
            <ul className="mt-3 space-y-2 text-[14px] text-muted">
              <li>The text of a Mac item on the server: {data.settings.snippetRetentionDays === 0 ? "until you delete it" : `${data.settings.snippetRetentionDays} days`}.</li>
              <li>Window titles, addresses, and search: {data.settings.retentionDays === 0 ? "until you delete them" : `${data.settings.retentionDays} days`}.</li>
              <li>Older screenshots: {data.settings.screenshotRetentionDays === 0 ? "until deleted" : `${data.settings.screenshotRetentionDays} days`}. The Mac app does not take screenshots.</li>
            </ul>
            <p className="mt-3 text-[14px] text-muted">
              <Link href="/settings#data" className="text-ink underline underline-offset-4">
                Download or delete your data
              </Link>{" "}
              from Settings. The privacy policy is <Link href="/privacy" className="text-ink underline underline-offset-4">here</Link>.
            </p>
          </section>

          <section className="rounded-2xl border border-line bg-panel p-5 md:p-6">
            <h2 className="text-[16px] font-medium">Someone else, in the last {data.eventDays} days</h2>
            {data.events.length === 0 ? (
              <p className="mt-2 text-[14px] text-muted">No one else has viewed you, opened your text, or exported your data in this window.</p>
            ) : (
              <ul className="mt-3 divide-y divide-line text-[14px]">
                {data.events.map((event, i) => (
                  <li key={`${event.at}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
                    <span>
                      {eventLine(event)}
                      {event.actor ? <span className="text-faint"> · {event.actor}</span> : null}
                    </span>
                    <span className="text-[13px] text-faint">{ago(event.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </PageFrame>
  );
}
