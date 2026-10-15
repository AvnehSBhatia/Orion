"use client";

// The firm's clients for the Mac app: Macs match each piece of work to a client on the device using names,
// aliases, domains, and project codes. Personal alias rules (made when someone changes an entry's client) can be
// accepted here to apply to everyone.

import { field, Notice, Panel, PrimaryButton, SecondaryButton } from "@/components/ui/form";
import { api } from "@/lib/api/client";
import type { AdminAliasRule, ClientImportResult, MacClient, MacClientInput } from "@/lib/api/types";
import { settingsError } from "@/lib/notLive";
import { ago } from "@/lib/time";
import { cn } from "@/lib/utils";
import { type FormEvent, useCallback, useEffect, useState } from "react";

type Msg = { kind: "ok" | "error"; text: string } | null;

/** The form's text fields: lists are typed comma or semicolon separated. */
type Draft = { name: string; aliases: string; domains: string; project_codes: string };

const EMPTY: Draft = { name: "", aliases: "", domains: "", project_codes: "" };
const list = (text: string) => [...new Set(text.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean))];
const toDraft = (c: MacClient): Draft => ({ name: c.name, aliases: c.aliases.join(", "), domains: c.domains.join(", "), project_codes: c.project_codes.join(", ") });
const toInput = (d: Draft): MacClientInput & { name: string } => ({
  name: d.name.trim(),
  aliases: list(d.aliases),
  domains: list(d.domains),
  project_codes: list(d.project_codes),
});

export function ClientsPanel() {
  const [clients, setClients] = useState<MacClient[] | null>(null);
  const [rules, setRules] = useState<AdminAliasRule[] | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [editing, setEditing] = useState<{ id: string; draft: Draft } | null>(null);

  const load = useCallback(async () => {
    const [c, r] = await Promise.allSettled([api.owner.clients(), api.owner.aliasRules()]);
    setClients(c.status === "fulfilled" ? c.value.clients : []);
    setRules(r.status === "fulfilled" ? r.value.rules : []);
    const failed = c.status === "rejected" ? c.reason : r.status === "rejected" ? r.reason : null;
    if (failed) setMsg({ kind: "error", text: settingsError(failed, "list clients") });
  }, []);
  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const update = async (client: MacClient, change: MacClientInput, done: string) => {
    setMsg(null);
    try {
      await api.owner.updateClient(client.id, change);
      setMsg({ kind: "ok", text: done });
      setEditing(null);
      await load();
    } catch (err) {
      setMsg({ kind: "error", text: settingsError(err, "change this client") });
    }
  };

  const saveEdit = (e: FormEvent, client: MacClient) => {
    e.preventDefault();
    if (!editing) return;
    const input = toInput(editing.draft);
    if (!input.name) return setMsg({ kind: "error", text: "A client needs a name." });
    void update(client, input, `Saved ${input.name}.`);
  };

  const sorted = [...(clients ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  const names = new Map((clients ?? []).map((c) => [c.id, c.name]));

  return (
    <>
      <AddClientPanel onChange={load} />
      <Panel title="Clients" description="Macs download this list and match each piece of work to a client on the device. Deactivated clients stop matching but keep their past time.">
        {msg && (
          <div className="mb-3">
            <Notice kind={msg.kind}>{msg.text}</Notice>
          </div>
        )}
        {clients === null ? (
          <div className="h-24 animate-pulse rounded-lg bg-raised" aria-label="Loading clients" />
        ) : clients.length === 0 ? (
          <p className="text-[14px] text-faint">No clients yet. Add one above or import a CSV.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[760px] text-left text-[14px]">
              <thead>
                <tr className="border-b border-line font-mono text-[11px] tracking-[0.08em] text-faint uppercase">
                  <th className="px-3 py-2 font-normal">Client</th>
                  <th className="px-3 py-2 font-normal">Aliases</th>
                  <th className="px-3 py-2 font-normal">Domains</th>
                  <th className="px-3 py-2 font-normal">Project codes</th>
                  <th className="px-3 py-2 font-normal">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((c) =>
                  editing?.id === c.id ? (
                    <tr key={c.id} className="border-b border-line last:border-0 align-top">
                      <td colSpan={5} className="px-3 py-3">
                        <form onSubmit={(e) => saveEdit(e, c)} className="grid gap-3">
                          <ClientFields draft={editing.draft} onChange={(draft) => setEditing({ id: c.id, draft })} />
                          <div className="flex gap-2">
                            <PrimaryButton type="submit" className="h-9">
                              Save
                            </PrimaryButton>
                            <SecondaryButton type="button" onClick={() => setEditing(null)}>
                              Cancel
                            </SecondaryButton>
                          </div>
                        </form>
                      </td>
                    </tr>
                  ) : (
                    <tr key={c.id} className={cn("border-b border-line last:border-0 align-top", !c.active && "opacity-60")}>
                      <td className="px-3 py-2.5">
                        <p className="text-ink">{c.name}</p>
                        {!c.active && <p className="text-[12px] text-faint">Deactivated</p>}
                      </td>
                      <td className="px-3 py-2.5 text-muted">{c.aliases.join(", ") || "—"}</td>
                      <td className="px-3 py-2.5 font-mono text-[12.5px] text-muted">{c.domains.join(", ") || "—"}</td>
                      <td className="px-3 py-2.5 font-mono text-[12.5px] text-muted">{c.project_codes.join(", ") || "—"}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex justify-end gap-2">
                          <SecondaryButton type="button" onClick={() => setEditing({ id: c.id, draft: toDraft(c) })}>
                            Edit
                          </SecondaryButton>
                          <SecondaryButton
                            type="button"
                            onClick={() => {
                              if (c.active && !window.confirm(`Deactivate ${c.name}? Macs stop matching work to it.`)) return;
                              void update(c, { active: !c.active }, c.active ? `${c.name} was deactivated.` : `${c.name} is active again.`);
                            }}
                          >
                            {c.active ? "Deactivate" : "Activate"}
                          </SecondaryButton>
                        </div>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <ImportPanel onChange={load} />
      <RulesPanel rules={rules} names={names} onChange={load} />
    </>
  );
}

function ClientFields({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) {
  const set = (key: keyof Draft, value: string) => onChange({ ...draft, [key]: value });
  const label = "block text-sm text-muted";
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className={label}>
        Name
        <input className={field} value={draft.name} onChange={(e) => set("name", e.target.value)} maxLength={200} placeholder="Initech" required />
      </label>
      <label className={label}>
        Aliases
        <input className={field} value={draft.aliases} onChange={(e) => set("aliases", e.target.value)} placeholder="Initech Corp, INTC" />
      </label>
      <label className={label}>
        Domains
        <input className={`${field} font-mono text-[13px]`} value={draft.domains} onChange={(e) => set("domains", e.target.value)} placeholder="initech.com" spellCheck={false} />
      </label>
      <label className={label}>
        Project codes
        <input className={`${field} font-mono text-[13px]`} value={draft.project_codes} onChange={(e) => set("project_codes", e.target.value)} placeholder="INI-, INI-204" spellCheck={false} />
      </label>
    </div>
  );
}

function AddClientPanel({ onChange }: { onChange: () => Promise<void> }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const input = toInput(draft);
    if (!input.name) return setMsg({ kind: "error", text: "A client needs a name." });
    setBusy(true);
    setMsg(null);
    try {
      const created = await api.owner.createClient(input);
      setDraft(EMPTY);
      setMsg({ kind: "ok", text: `Added ${created.name}. Macs pick it up within 15 minutes.` });
      await onChange();
    } catch (err) {
      setMsg({ kind: "error", text: settingsError(err, "add a client") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Add a client" description="Separate several aliases, domains, or codes with commas. A code ending in a dash matches as a prefix (INI- matches INI-204).">
      <form onSubmit={submit} className="grid gap-4">
        <ClientFields draft={draft} onChange={setDraft} />
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
        <div>
          <PrimaryButton type="submit" disabled={busy}>
            {busy ? "Adding…" : "Add client"}
          </PrimaryButton>
        </div>
      </form>
    </Panel>
  );
}

function ImportPanel({ onChange }: { onChange: () => Promise<void> }) {
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<ClientImportResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setCsv(await file.text());
    setResult(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!csv.trim()) return setError("Choose a CSV file or paste its contents.");
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult(await api.owner.importClients(csv));
      await onChange();
    } catch (err) {
      setError(settingsError(err, "import clients"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Import clients"
      description={
        <>
          A CSV with the header <code className="font-mono text-ink">name,aliases,domains,project_codes</code>. Put several values in one cell with{" "}
          <code className="font-mono text-ink">;</code>. A client whose name already exists is updated.
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-4">
        <label className="block text-sm text-muted">
          CSV file
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => void pick(e.target.files?.[0])}
            className="mt-1.5 block w-full text-[13px] text-muted file:mr-3 file:h-9 file:rounded-md file:border file:border-line-strong file:bg-transparent file:px-3 file:text-ink"
          />
        </label>
        <label className="block text-sm text-muted">
          Or paste it
          <textarea
            className={`${field} h-32 py-2 font-mono text-[13px]`}
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={"name,aliases,domains,project_codes\nInitech,Initech Corp;INTC,initech.com,INI-"}
            spellCheck={false}
          />
        </label>
        {error && <Notice kind="error">{error}</Notice>}
        {result && (
          <div role="status" className="text-[13px] text-muted">
            <p>
              Added {result.created}, updated {result.updated}
              {result.errors.length ? `, ${result.errors.length} line${result.errors.length === 1 ? "" : "s"} skipped:` : "."}
            </p>
            {result.errors.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-danger">
                {result.errors.slice(0, 20).map((e) => (
                  <li key={e.line}>
                    Line {e.line}: {e.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div>
          <PrimaryButton type="submit" disabled={busy}>
            {busy ? "Importing…" : "Import"}
          </PrimaryButton>
        </div>
      </form>
    </Panel>
  );
}

function RulesPanel({ rules, names, onChange }: { rules: AdminAliasRule[] | null; names: Map<string, string>; onChange: () => Promise<void> }) {
  const [msg, setMsg] = useState<Msg>(null);
  const pending = (rules ?? []).filter((r) => r.scope === "user" && r.status === "pending");
  const org = (rules ?? []).filter((r) => r.scope === "org");

  const accept = async (rule: AdminAliasRule) => {
    setMsg(null);
    try {
      await api.owner.acceptRule(rule.id);
      setMsg({ kind: "ok", text: `"${rule.pattern}" now matches ${rule.client_name || names.get(rule.client_id) || "that client"} for everyone.` });
      await onChange();
    } catch (err) {
      setMsg({ kind: "error", text: settingsError(err, "accept this rule") });
    }
  };

  const clientOf = (r: AdminAliasRule) => r.client_name || names.get(r.client_id) || "Unknown client";

  return (
    <Panel
      title="Alias rules"
      description="When someone changes an entry's client, Orion remembers it for them as a personal rule. Accept a rule to apply it to everyone's Mac."
    >
      {msg && (
        <div className="mb-3">
          <Notice kind={msg.kind}>{msg.text}</Notice>
        </div>
      )}
      <h3 className="text-[13px] font-medium text-muted">Waiting for review</h3>
      {rules === null ? (
        <div className="mt-2 h-12 animate-pulse rounded-lg bg-raised" aria-label="Loading rules" />
      ) : pending.length === 0 ? (
        <p className="mt-2 text-[14px] text-faint">No personal rules to review.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
          {pending.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] text-ink">
                  <span className="font-mono text-[13px]">{r.pattern}</span> → {clientOf(r)}
                </p>
                <p className="text-[12px] text-faint">
                  {r.user_name ?? r.user_id ?? "Someone"} · {ago(r.created_at)}
                </p>
              </div>
              <SecondaryButton type="button" onClick={() => accept(r)}>
                Accept for everyone
              </SecondaryButton>
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-6 text-[13px] font-medium text-muted">Org-wide rules</h3>
      {rules !== null &&
        (org.length === 0 ? (
          <p className="mt-2 text-[14px] text-faint">None yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
            {org.map((r) => (
              <li key={r.id} className="px-3 py-2.5 text-[14px] text-ink">
                <span className="font-mono text-[13px]">{r.pattern}</span> → {clientOf(r)}
              </li>
            ))}
          </ul>
        ))}
    </Panel>
  );
}
