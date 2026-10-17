"use client";

// The signed-in person's time entries, grouped by client. Review still happens in the Mac app.

import { PageFrame } from "@/components/settings/PageFrame";
import { field, Notice } from "@/components/ui/form";
import { Quiet } from "@/components/ui/Quiet";
import { api } from "@/lib/api/client";
import type { MyTimesheet } from "@/lib/api/types";
import { settingsError } from "@/lib/notLive";
import { type FormEvent, useCallback, useEffect, useState } from "react";

function localDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const defaultRange = () => {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 13);
  return { from: localDay(from), to: localDay(to) };
};

const STATUS: Record<MyTimesheet["entries"][number]["status"], string> = {
  proposed: "Draft",
  accepted: "Accepted",
  edited: "Edited",
  rejected: "Rejected",
};

function hours(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  if (!m) return `${h}h`;
  return `${h}h ${m}m`;
}

export function TimesheetPage() {
  const [range, setRange] = useState(defaultRange);
  const [sheet, setSheet] = useState<MyTimesheet | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async (from: string, to: string) => {
    setError("");
    try {
      setSheet(await api.me.time(from, to));
    } catch (err) {
      setError(settingsError(err, "load your timesheet"));
      setSheet(null);
    }
  }, []);

  useEffect(() => {
    const { from, to } = defaultRange();
    const t = window.setTimeout(() => void load(from, to), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (range.from > range.to) return setError("The start date is after the end date.");
    setSheet(null);
    void load(range.from, range.to);
  };

  const download = () => {
    if (!sheet) return;
    const lines = ["date,client,minutes,description,status", ...sheet.entries.map((e) => [e.day, e.client, e.minutes, e.narrative, e.status].map(csv).join(","))];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `timesheet-${sheet.from}-to-${sheet.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <PageFrame
      title="Timesheet"
      description="Time Orion drafted from work you already did, by client. Accept, edit, or reject a day in the Mac app. This page is the record."
    >
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <label className="block text-sm text-muted">
          From
          <input className={field} type="date" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} required />
        </label>
        <label className="block text-sm text-muted">
          To
          <input className={field} type="date" value={range.to} min={range.from} onChange={(e) => setRange({ ...range, to: e.target.value })} required />
        </label>
        <button type="submit" className="h-11 rounded-md border border-line-strong px-4 text-sm text-ink hover:bg-raised">
          Show
        </button>
        <button type="button" onClick={download} disabled={!sheet?.entries.length} className="h-11 rounded-md border border-line-strong px-4 text-sm text-ink hover:bg-raised disabled:opacity-40">
          Download CSV
        </button>
      </form>
      {error && <Notice kind="error">{error}</Notice>}

      {sheet && (
        <div className="mt-6 grid gap-4">
          <section className="rounded-2xl border border-line bg-panel p-5 md:p-6">
            <h2 className="text-[16px] font-medium">By client</h2>
            <p className="mt-1 text-[14px] text-muted">Accepted and edited time. Drafts are in the list below and are not in this total.</p>
            {sheet.clients.length === 0 ? (
              <p className="mt-3 text-[14px] text-muted">Nothing accepted in this range yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-line text-[14px]">
                {sheet.clients.map((c) => (
                  <li key={c.client} className="flex items-baseline justify-between gap-4 py-2">
                    <span>{c.client}</span>
                    <span className="tabular-nums text-faint">
                      {hours(c.minutes)} <span className="text-[12px]">· {c.entries}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-line bg-panel p-5 md:p-6">
            <h2 className="text-[16px] font-medium">Entries</h2>
            {sheet.entries.length === 0 ? (
              <Quiet title="No time entries in this range" detail="They show up after your Mac sends approved work and Orion drafts the day." className="py-8" />
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-[14px]">
                  <thead className="text-[12px] text-faint">
                    <tr>
                      <th className="py-2 pr-3 font-normal">Date</th>
                      <th className="py-2 pr-3 font-normal">Client</th>
                      <th className="py-2 pr-3 font-normal">Time</th>
                      <th className="py-2 pr-3 font-normal">Description</th>
                      <th className="py-2 font-normal">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.entries.map((e, i) => (
                      <tr key={`${e.day}-${i}`} className="border-t border-line align-top">
                        <td className="py-2.5 pr-3 whitespace-nowrap tabular-nums">{e.day}</td>
                        <td className="py-2.5 pr-3">{e.client}</td>
                        <td className="py-2.5 pr-3 whitespace-nowrap tabular-nums">{hours(e.minutes)}</td>
                        <td className="py-2.5 pr-3 text-muted">{e.narrative}</td>
                        <td className="py-2.5 whitespace-nowrap text-faint">{STATUS[e.status]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </PageFrame>
  );
}

function csv(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
