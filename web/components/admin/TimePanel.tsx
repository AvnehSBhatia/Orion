"use client";

// Pilot totals from the Mac app's daily drafts, per person, and the firm-wide CSV of accepted time.
// No snippets or titles reach this page: only counts and days.

import { field, Notice, Panel, PrimaryButton, SecondaryButton } from "@/components/ui/form";
import { api } from "@/lib/api/client";
import type { PilotPerson } from "@/lib/api/types";
import { settingsError } from "@/lib/notLive";
import { type FormEvent, useCallback, useEffect, useState } from "react";

/** YYYY-MM-DD in the viewer's own time zone. */
function localDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const defaultRange = () => {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 13);
  return { from: localDay(from), to: localDay(to) };
};

export function TimePanel() {
  const [range, setRange] = useState(defaultRange);
  const [people, setPeople] = useState<PilotPerson[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (from: string, to: string) => {
    setError("");
    try {
      setPeople((await api.owner.pilot(from, to)).people);
    } catch (err) {
      setError(settingsError(err, "read pilot totals"));
      setPeople([]);
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
    setPeople(null);
    void load(range.from, range.to);
  };

  const exportCsv = async () => {
    if (range.from > range.to) return setError("The start date is after the end date.");
    setBusy(true);
    setError("");
    try {
      await api.owner.exportCsv(range.from, range.to);
    } catch (err) {
      setError(settingsError(err, "export time"));
    } finally {
      setBusy(false);
    }
  };

  const total = (people ?? []).reduce((n, p) => ({ accepted: n.accepted + p.accepted, edited: n.edited + p.edited, rejected: n.rejected + p.rejected }), {
    accepted: 0,
    edited: 0,
    rejected: 0,
  });
  const cell = "px-3 py-2.5 text-right tabular-nums text-muted";

  return (
    <Panel
      title="Time"
      description="How people review the daily drafts their Macs propose. The CSV has every accepted and edited entry for everyone in the range: date, person, client, minutes, description."
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
        <PrimaryButton type="submit">Show</PrimaryButton>
        <SecondaryButton type="button" className="h-11" disabled={busy} onClick={exportCsv}>
          {busy ? "Preparing…" : "Download CSV"}
        </SecondaryButton>
      </form>

      {error && (
        <div className="mt-4">
          <Notice kind="error">{error}</Notice>
        </div>
      )}

      <div className="mt-5">
        {people === null ? (
          <div className="h-24 animate-pulse rounded-lg bg-raised" aria-label="Loading pilot totals" />
        ) : people.length === 0 ? (
          <p className="text-[14px] text-faint">No reviewed drafts in this range.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[560px] text-left text-[14px]">
              <thead>
                <tr className="border-b border-line font-mono text-[11px] tracking-[0.08em] text-faint uppercase">
                  <th className="px-3 py-2 font-normal">Person</th>
                  <th className="px-3 py-2 text-right font-normal">Accepted</th>
                  <th className="px-3 py-2 text-right font-normal">Edited</th>
                  <th className="px-3 py-2 text-right font-normal">Rejected</th>
                  <th className="px-3 py-2 text-right font-normal">Active days</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.user_id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2.5 text-ink">{p.name || p.user_id}</td>
                    <td className={cell}>{p.accepted}</td>
                    <td className={cell}>{p.edited}</td>
                    <td className={cell}>{p.rejected}</td>
                    <td className={cell}>{p.active_days}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line-strong">
                  <td className="px-3 py-2.5 text-muted">Everyone</td>
                  <td className={cell}>{total.accepted}</td>
                  <td className={cell}>{total.edited}</td>
                  <td className={cell}>{total.rejected}</td>
                  <td className={cell} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </Panel>
  );
}
