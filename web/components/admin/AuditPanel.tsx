"use client";

import { Notice, Panel, SecondaryButton } from "@/components/ui/form";
import { api } from "@/lib/api/client";
import type { AuditEvent } from "@/lib/api/types";
import { settingsError } from "@/lib/notLive";
import { useCallback, useEffect, useState } from "react";

const ACTION: Record<string, string> = {
  login: "Signed in",
  login_failed: "Failed sign-in",
  logout: "Signed out",
  token_created: "Created a token",
  token_revoked: "Revoked a token",
  account_created: "Created an account",
  account_updated: "Changed an account",
  password_changed: "Changed their password",
  password_reset: "Reset a password",
  invite_created: "Created an invite",
  invite_accepted: "Accepted an invite",
  settings_changed: "Changed org settings",
  data_deleted: "Deleted data",
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function AuditPanel() {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      setEvents((await api.audit(100)).events);
      setError("");
    } catch (err) {
      setError(settingsError(err, "read the audit log"));
      setEvents((e) => e ?? []);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  return (
    <Panel
      title="Audit log"
      description="The last 100 security events in your org: sign-ins, tokens, account and settings changes, deletions."
      actions={
        <SecondaryButton type="button" onClick={() => void load()} disabled={busy}>
          {busy ? "Loading…" : "Refresh"}
        </SecondaryButton>
      }
    >
      {error && (
        <div className="mb-3">
          <Notice kind="error">{error}</Notice>
        </div>
      )}
      {events === null ? (
        <div className="h-40 animate-pulse rounded-lg bg-raised" aria-label="Loading audit log" />
      ) : events.length === 0 ? (
        !error && <p className="text-[14px] text-faint">Nothing logged yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[640px] text-left text-[14px]">
            <thead>
              <tr className="border-b border-line font-mono text-[11px] tracking-[0.08em] text-faint uppercase">
                <th className="px-3 py-2 font-normal">When</th>
                <th className="px-3 py-2 font-normal">Who</th>
                <th className="px-3 py-2 font-normal">What</th>
                <th className="px-3 py-2 font-normal">Detail</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => (
                <tr key={`${e.at}-${i}`} className="border-b border-line align-top last:border-0">
                  <td className="px-3 py-2 whitespace-nowrap text-muted">{when(e.at)}</td>
                  <td className="px-3 py-2 text-ink">{e.actor || "—"}</td>
                  <td className="px-3 py-2">
                    <span className={e.action === "login_failed" ? "text-danger" : "text-ink"}>{ACTION[e.action] ?? e.action.replace(/_/g, " ")}</span>
                    {e.target && <span className="text-muted"> · {e.target}</span>}
                  </td>
                  <td className="px-3 py-2 text-[13px] break-words text-faint">{e.detail || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
