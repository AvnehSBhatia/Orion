"use client";

import { field, Notice, Panel, PrimaryButton } from "@/components/ui/form";
import { api } from "@/lib/api/client";
import { settingsError } from "@/lib/notLive";
import { type FormEvent, useEffect, useState } from "react";

export function OrgProfilePanel({ orgId }: { orgId: string }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [context, setContext] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api.org
      .get(orgId)
      .then(({ org }) => {
        if (!alive) return;
        setName(org.name);
        setDescription(org.description === org.id ? "" : org.description);
        setContext(org.context);
      })
      .catch(() => {})
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [orgId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api.org.update(orgId, { name: name.trim(), description: description.trim(), context: context.trim() });
      setMsg({ kind: "ok", text: "Saved. New captures are read with this profile." });
    } catch (err) {
      setMsg({ kind: "error", text: settingsError(err, "edit the org profile") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Org profile" description="Orion reads this when it sorts captures into projects. Existing captures are not re-read.">
      {!loaded ? (
        <div className="h-40 animate-pulse rounded-lg bg-raised" aria-label="Loading profile" />
      ) : (
        <form onSubmit={submit} className="grid max-w-2xl gap-5">
          <label className="block text-sm text-muted">
            Company name
            <input className={field} value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
          </label>
          <label className="block text-sm text-muted">
            What you build
            <textarea
              className={`${field} h-24 py-2`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              placeholder="We build an AI support assistant for enterprise support teams."
            />
          </label>
          <label className="block text-sm text-muted">
            Anything else Orion should know (optional)
            <textarea
              className={`${field} h-24 py-2`}
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="Team names, product names, customers, what counts as a project."
            />
          </label>
          {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
          <div>
            <PrimaryButton type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save profile"}
            </PrimaryButton>
          </div>
        </form>
      )}
    </Panel>
  );
}
