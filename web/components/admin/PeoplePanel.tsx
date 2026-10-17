"use client";

import { CopyField } from "@/components/ui/CopyButton";
import { field, Notice, Panel, PrimaryButton, SecondaryButton } from "@/components/ui/form";
import { useSession } from "@/components/auth/session";
import { api, statusOf } from "@/lib/api/client";
import type { Account, CreatedInvite, EmailStatus, Invite } from "@/lib/api/types";
import { settingsError } from "@/lib/notLive";
import { ago, shortDate, useNow } from "@/lib/time";
import { cn } from "@/lib/utils";
import { type FormEvent, useCallback, useEffect, useState } from "react";

type Msg = { kind: "ok" | "error"; text: string } | null;

/** One line on how a link went out, ending with when it expires. */
function delivery(status: EmailStatus, email: string | null, what: string, expires: string): string {
  if (status === "sent") return `Emailed to ${email}. You can also copy the ${what} below; it works once and expires ${expires}.`;
  if (status === "failed") return `The email to ${email} didn't go out. Copy the ${what} and send it to them privately; it works once and expires ${expires}.`;
  if (status === "not_configured") return `Email isn't set up on this server, so nothing was sent. Copy the ${what} and send it to them privately; it works once and expires ${expires}.`;
  return `Send the ${what} to them privately; it works once and expires ${expires}.`;
}

export function PeoplePanel({ self }: { self: string }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [reset, setReset] = useState<{ username: string; email: string | null; url: string; expiresAt: string; emailStatus: EmailStatus } | null>(null);

  const load = useCallback(async () => {
    const [a, i] = await Promise.allSettled([api.accounts.list(), api.invites.list()]);
    setAccounts(a.status === "fulfilled" ? a.value.accounts : []);
    setInvites(i.status === "fulfilled" ? i.value.invites : []);
    const failed = a.status === "rejected" ? a.reason : i.status === "rejected" ? i.reason : null;
    if (failed) setMsg({ kind: "error", text: settingsError(failed, "list people") });
  }, []);
  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const update = async (account: Account, change: Partial<Pick<Account, "admin" | "disabled">>, done: string) => {
    if (change.disabled && !window.confirm(`Disable ${account.name || account.username}? They are signed out everywhere and their tokens stop working.`)) return;
    setMsg(null);
    try {
      await api.accounts.update(account.username, change);
      setMsg({ kind: "ok", text: done });
      await load();
    } catch (err) {
      setMsg({ kind: "error", text: settingsError(err, "change this account") });
    }
  };

  const { me: session } = useSession();
  const exportData = async (account: Account) => {
    setMsg(null);
    try {
      await api.exportPerson(session.orgId ?? "", account.userId);
      setMsg({ kind: "ok", text: `Downloaded ${account.name || account.username}'s data. The export is in the audit log.` });
    } catch (err) {
      setMsg({ kind: "error", text: settingsError(err, "export this person's data") });
    }
  };

  const resetLink = async (account: Account) => {
    setMsg(null);
    try {
      const { resetUrl, expiresAt, emailStatus } = await api.accounts.resetLink(account.username);
      setReset({ username: account.username, email: account.email, url: resetUrl, expiresAt, emailStatus });
    } catch (err) {
      setMsg({ kind: "error", text: settingsError(err, "create a reset link") });
    }
  };

  return (
    <>
      <InvitePanel invites={invites} onChange={load} />
      <Panel title="People" description="Everyone with an Orion account in your org.">
        {msg && (
          <div className="mb-3">
            <Notice kind={msg.kind}>{msg.text}</Notice>
          </div>
        )}
        {reset && (
          <div className="mb-4 rounded-xl border border-ink/40 bg-bg p-4" role="status">
            <p className="text-[14px] text-ink">
              Reset link for @{reset.username}. {delivery(reset.emailStatus, reset.email, "link", shortDate(reset.expiresAt))}
            </p>
            <div className="mt-2">
              <CopyField value={reset.url} label="Copy the reset link" />
            </div>
          </div>
        )}
        {accounts === null ? (
          <div className="h-24 animate-pulse rounded-lg bg-raised" aria-label="Loading people" />
        ) : accounts.length === 0 ? (
          <p className="text-[14px] text-faint">No accounts to show.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[820px] text-left text-[14px]">
              <thead>
                <tr className="border-b border-line font-mono text-[11px] tracking-[0.08em] text-faint uppercase">
                  <th className="px-3 py-2 font-normal">Person</th>
                  <th className="px-3 py-2 font-normal">Role</th>
                  <th className="px-3 py-2 font-normal">Last seen</th>
                  <th className="px-3 py-2 font-normal">Notice</th>
                  <th className="px-3 py-2 font-normal">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const me = a.username === self;
                  return (
                    <tr key={a.username} className={cn("border-b border-line last:border-0", a.disabled && "opacity-60")}>
                      <td className="px-3 py-2.5">
                        <p className="text-ink">
                          {a.name || a.username}
                          {me && <span className="ml-1.5 text-[12px] text-faint">(you)</span>}
                        </p>
                        <p className="text-[12px] text-faint">
                          @{a.username}
                          {a.email ? ` · ${a.email}` : ""}
                        </p>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-muted">{a.disabled ? "Disabled" : a.admin ? "Admin" : "Member"}</span>
                      </td>
                      <td className="px-3 py-2.5 text-muted">{a.lastSeenAt ? ago(a.lastSeenAt) : "Never"}</td>
                      <td className="px-3 py-2.5 text-muted">{a.consentAt ? `Accepted ${shortDate(a.consentAt)}` : "Not yet"}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex justify-end gap-2">
                          <SecondaryButton
                            type="button"
                            disabled={me || a.disabled}
                            onClick={() => update(a, { admin: !a.admin }, a.admin ? `${a.username} is no longer an admin.` : `${a.username} is now an admin.`)}
                          >
                            {a.admin ? "Remove admin" : "Make admin"}
                          </SecondaryButton>
                          <SecondaryButton type="button" disabled={a.disabled} onClick={() => resetLink(a)}>
                            Reset link
                          </SecondaryButton>
                          <SecondaryButton type="button" onClick={() => exportData(a)}>
                            Export data
                          </SecondaryButton>
                          <SecondaryButton
                            type="button"
                            disabled={me}
                            onClick={() => update(a, { disabled: !a.disabled }, a.disabled ? `${a.username} can sign in again.` : `${a.username} was disabled.`)}
                          >
                            {a.disabled ? "Enable" : "Disable"}
                          </SecondaryButton>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

function InvitePanel({ invites, onChange }: { invites: Invite[] | null; onChange: () => Promise<void> }) {
  const [admin, setAdmin] = useState(false);
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [created, setCreated] = useState<(CreatedInvite & { email: string | null }) | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const to = email.trim() || undefined;
      const invite = await api.invites.create({ admin, role: role.trim() || undefined, email: to, name: name.trim() || undefined });
      setCreated({ ...invite, email: to ?? null });
      setRole("");
      setEmail("");
      setName("");
      setAdmin(false);
      await onChange();
    } catch (err) {
      setMsg({ kind: "error", text: statusOf(err) === 409 ? "Someone already has an account with that email." : settingsError(err, "create an invite") });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (invite: Invite) => {
    if (!window.confirm("Revoke this invite link? It stops working right away.")) return;
    try {
      await api.invites.revoke(invite.id);
      if (created?.id === invite.id) setCreated(null);
      await onChange();
    } catch (err) {
      setMsg({ kind: "error", text: settingsError(err, "revoke this invite") });
    }
  };

  const now = useNow(60_000);
  const pending = (invites ?? []).filter((i) => !i.usedBy && Date.parse(i.expiresAt) > now);
  const used = (invites ?? []).filter((i) => i.usedBy);

  return (
    <Panel
      id="invite"
      title="Invite people"
      description="Email someone a one-time link (valid 7 days), or leave the email empty and copy the link. The person picks their own username and password."
    >
      <form onSubmit={create} className="flex flex-wrap items-end gap-3">
        <label className="block min-w-[220px] flex-1 text-sm text-muted">
          Their email
          <input className={field} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="sam@yourcompany.com" autoComplete="off" maxLength={200} />
        </label>
        <label className="block min-w-[180px] flex-1 text-sm text-muted">
          Their name (optional)
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Sam Kim" autoComplete="off" maxLength={80} />
        </label>
        <label className="block min-w-[220px] flex-1 text-sm text-muted">
          Their role (optional)
          <input className={field} value={role} onChange={(e) => setRole(e.target.value)} placeholder="Account executive" maxLength={120} />
        </label>
        <label className="flex h-11 items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} className="size-4 accent-[#ededed]" />
          Make them an admin
        </label>
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? (email.trim() ? "Sending…" : "Creating…") : email.trim() ? "Send invite" : "Create invite link"}
        </PrimaryButton>
      </form>
      {created && (
        <div className="mt-4 rounded-xl border border-ink/40 bg-bg p-4" role="status">
          <p className="text-[14px] text-ink">Invite ready. {delivery(created.emailStatus, created.email, "invite link", shortDate(created.expiresAt))}</p>
          <div className="mt-2">
            <CopyField value={created.inviteUrl} label="Copy the invite link" />
          </div>
        </div>
      )}
      {msg && (
        <div className="mt-3">
          <Notice kind={msg.kind}>{msg.text}</Notice>
        </div>
      )}
      <h3 className="mt-6 text-[13px] font-medium text-muted">Pending invites</h3>
      {invites === null ? (
        <div className="mt-2 h-10 animate-pulse rounded-lg bg-raised" />
      ) : pending.length === 0 ? (
        <p className="mt-2 text-[14px] text-faint">None pending.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
          {pending.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1 text-[14px]">
                <p className="text-ink">
                  {i.name || i.email || i.role || "No role set"}
                  {i.admin && <span className="ml-2 text-[12px] text-faint">Admin</span>}
                </p>
                {(i.name || i.email) && (i.role || (i.name && i.email)) && (
                  <p className="text-[12px] text-muted">{[i.name ? i.email : null, i.role].filter(Boolean).join(" · ")}</p>
                )}
                <p className="text-[12px] text-faint">
                  By @{i.createdBy} {ago(i.createdAt)} · expires {shortDate(i.expiresAt)}
                </p>
              </div>
              <SecondaryButton type="button" onClick={() => revoke(i)}>
                Revoke
              </SecondaryButton>
            </li>
          ))}
        </ul>
      )}
      {used.length > 0 && (
        <p className="mt-3 text-[13px] text-faint">
          Accepted: {used.map((i) => `@${i.usedBy}`).join(", ")}
        </p>
      )}
    </Panel>
  );
}
