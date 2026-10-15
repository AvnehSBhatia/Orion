"use client";

import { useSession } from "@/components/auth/session";
import { PageFrame } from "@/components/settings/PageFrame";
import { CopyField } from "@/components/ui/CopyButton";
import { field, FieldError, Notice, Panel, PrimaryButton, SecondaryButton } from "@/components/ui/form";
import { API, api, statusOf } from "@/lib/api/client";
import type { CreatedToken, TokenInfo } from "@/lib/api/types";
import { settingsError } from "@/lib/notLive";
import { ago, shortDate } from "@/lib/time";
import { type FormEvent, useCallback, useEffect, useState } from "react";

const SECTIONS = [
  { id: "account", label: "Account" },
  { id: "password", label: "Password" },
  { id: "claude-code", label: "Connect Claude Code" },
  { id: "data", label: "Your data" },
];

export function SettingsPage() {
  return (
    <PageFrame title="Settings" description="Your account, password, and connections." sections={SECTIONS}>
      <AccountPanel />
      <PasswordPanel />
      <ClaudeCodePanel />
      <DataPanel />
    </PageFrame>
  );
}

function AccountPanel() {
  const { me } = useSession();
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (!me.orgId) return;
    let alive = true;
    api
      .users(me.orgId)
      .then(({ users }) => alive && setName(users.find((u) => u.id === me.userId)?.name ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [me.orgId, me.userId]);
  const rows: [string, string][] = [
    ["Name", name ?? "…"],
    ["Username", me.username ?? "—"],
    ["Organization", me.orgId ?? "—"],
    ["Email", me.email || "Not set. Ask an admin to add one."],
    ["Role", me.admin ? "Admin" : "Member"],
  ];
  return (
    <Panel id="account" title="Account">
      <dl className="grid gap-x-6 gap-y-3 text-[14px] sm:grid-cols-[140px_minmax(0,1fr)]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-faint">{k}</dt>
            <dd className="min-w-0 break-words text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function PasswordPanel() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setResult(null);
    if (next.length < 8) return setResult({ kind: "error", text: "Use at least 8 characters." });
    if (next !== confirm) return setResult({ kind: "error", text: "The new passwords don't match." });
    setBusy(true);
    try {
      await api.auth.changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setResult({ kind: "ok", text: "Password changed. Your other sessions were signed out." });
    } catch (err) {
      const status = statusOf(err);
      setResult({
        kind: "error",
        text: status === 401 || status === 403 ? "Your current password isn't right." : settingsError(err, "change your password"),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel id="password" title="Change password" description="Changing it signs you out everywhere else.">
      <form onSubmit={submit} className="grid max-w-md gap-4">
        <label className="block text-sm text-muted">
          Current password
          <input className={field} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </label>
        <label className="block text-sm text-muted">
          New password
          <input className={field} type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required aria-describedby="pw-help" />
          <span id="pw-help" className="mt-1 block text-[12px] text-faint">
            At least 8 characters. A short phrase is easier to remember.
          </span>
        </label>
        <label className="block text-sm text-muted">
          Confirm new password
          <input className={field} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </label>
        {result?.kind === "error" ? <FieldError id="pw-error" message={result.text} /> : result ? <Notice kind="ok">{result.text}</Notice> : null}
        <div>
          <PrimaryButton type="submit" disabled={busy}>
            {busy ? "Saving…" : "Change password"}
          </PrimaryButton>
        </div>
      </form>
    </Panel>
  );
}

export const mcpCommand = (token: string) => `claude mcp add --transport http orion ${API}/api/mcp --header "Authorization: Bearer ${token}"`;

function ClaudeCodePanel() {
  const [tokens, setTokens] = useState<TokenInfo[] | null>(null);
  const [label, setLabel] = useState("Claude Code");
  const [created, setCreated] = useState<CreatedToken | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { tokens } = await api.tokens.list();
      setTokens(tokens.filter((t) => t.kind === "api"));
    } catch (err) {
      setError(settingsError(err, "list your tokens"));
      setTokens([]);
    }
  }, []);
  useEffect(() => {
    let alive = true;
    api.tokens
      .list()
      .then(({ tokens }) => alive && setTokens(tokens.filter((t) => t.kind === "api")))
      .catch((err) => {
        if (!alive) return;
        setError(settingsError(err, "list your tokens"));
        setTokens([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setCreated(await api.tokens.create(label.trim() || "Claude Code"));
      await load();
    } catch (err) {
      setError(settingsError(err, "create a token"));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (token: TokenInfo) => {
    if (!window.confirm(`Revoke "${token.label}"? Anything using it stops working right away.`)) return;
    try {
      await api.tokens.revoke(token.id);
      if (created?.id === token.id) setCreated(null);
      await load();
    } catch (err) {
      setError(settingsError(err, "revoke this token"));
    }
  };

  return (
    <Panel
      id="claude-code"
      title="Connect Claude Code"
      description="Give your coding agent this org's context over MCP. Create a token, then run the command in your terminal. Each token acts as you; revoke it when a machine is retired."
    >
      <form onSubmit={create} className="flex flex-wrap items-end gap-3">
        <label className="block min-w-[220px] flex-1 text-sm text-muted">
          Token name
          <input className={field} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="Claude Code on my laptop" />
        </label>
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create token"}
        </PrimaryButton>
      </form>

      {created && (
        <div className="mt-5 rounded-xl border border-ink/40 bg-bg p-4" role="status">
          <p className="text-[14px] text-ink">Copy this now. The token is shown only once.</p>
          <p className="mt-3 text-[12px] text-faint">Run in your terminal:</p>
          <div className="mt-1.5">
            <CopyField value={mcpCommand(created.token)} label="Copy the claude mcp add command" />
          </div>
          <p className="mt-3 text-[12px] text-faint">Or just the token (Cursor, Codex, CI):</p>
          <div className="mt-1.5">
            <CopyField value={created.token} label="Copy the token" />
          </div>
          <p className="mt-3 text-[12px] text-faint">
            Then ask Claude Code to call <code className="font-mono text-ink">context_for_task</code> at the start of a task.
          </p>
        </div>
      )}

      {error && (
        <div className="mt-4">
          <Notice kind="error">{error}</Notice>
        </div>
      )}

      <h3 className="mt-6 text-[13px] font-medium text-muted">Your tokens</h3>
      {tokens === null ? (
        <div className="mt-2 h-12 animate-pulse rounded-lg bg-raised" aria-label="Loading tokens" />
      ) : tokens.length === 0 ? (
        <p className="mt-2 text-[14px] text-faint">No tokens yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
          {tokens.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] text-ink">{t.label || "Untitled token"}</p>
                <p className="text-[12px] text-faint">
                  Created {ago(t.createdAt)} · {t.lastUsedAt ? `last used ${ago(t.lastUsedAt)}` : "never used"}
                  {t.expiresAt ? ` · expires ${shortDate(t.expiresAt)}` : ""}
                </p>
              </div>
              <SecondaryButton type="button" onClick={() => revoke(t)}>
                Revoke
              </SecondaryButton>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function DataPanel() {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const { deleted } = await api.me.deleteCaptures();
      setResult({ kind: "ok", text: `Deleted ${deleted} capture${deleted === 1 ? "" : "s"} and their screenshots.` });
      setTyped("");
    } catch (err) {
      setResult({ kind: "error", text: settingsError(err, "delete your captures") });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel
      id="data"
      title="Your captured data"
      description="Delete every page and screenshot the extension captured from you. Work items already built from them stay, without the raw text. This can't be undone."
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="block min-w-[220px] flex-1 text-sm text-muted">
          Type <span className="font-mono text-ink">delete</span> to confirm
          <input className={field} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </label>
        <button
          type="button"
          disabled={typed.trim().toLowerCase() !== "delete" || busy}
          onClick={run}
          className="h-11 rounded-md border border-danger/60 px-4 text-sm text-danger transition-colors hover:bg-danger/10 disabled:opacity-40"
        >
          {busy ? "Deleting…" : "Delete my captures"}
        </button>
      </div>
      {result && (
        <div className="mt-3">
          <Notice kind={result.kind}>{result.text}</Notice>
        </div>
      )}
    </Panel>
  );
}
