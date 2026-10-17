"use client";

// Public: accept an invite link. Shows which org it is for, then creates the account and signs in.

import { Centered } from "@/components/auth/Centered";
import { field, FieldError, PrimaryButton } from "@/components/ui/form";
import { Logo } from "@/components/ui/Logo";
import { api, statusOf } from "@/lib/api/client";
import type { InviteLookup } from "@/lib/api/types";
import { friendlyError } from "@/lib/errors";
import { shortDate } from "@/lib/time";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

type Lookup = { kind: "loading" } | { kind: "ok"; invite: InviteLookup } | { kind: "invalid" } | { kind: "error"; text: string };

export function InviteForm({ token }: { token: string }) {
  const router = useRouter();
  const [lookup, setLookup] = useState<Lookup>({ kind: "loading" });
  const [form, setForm] = useState({ name: "", role: "", email: "", username: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    api.invites
      .lookup(token)
      .then((invite) => {
        if (!alive) return;
        setLookup({ kind: "ok", invite });
        // Fill in what the admin typed when they sent it.
        setForm((f) => ({ ...f, name: f.name || invite.name || "", email: f.email || invite.email || "" }));
      })
      .catch((err) => {
        if (!alive) return;
        const status = statusOf(err);
        setLookup(status === 404 || status === 410 ? { kind: "invalid" } : { kind: "error", text: friendlyError(err, "open this invite") });
      });
    return () => {
      alive = false;
    };
  }, [token]);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    const username = form.username.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{1,39}$/.test(username)) return setError("Usernames are 2 to 40 characters: letters, numbers, dots, dashes, underscores.");
    if (form.password.length < 8) return setError("Use a password of at least 8 characters.");
    setBusy(true);
    try {
      await api.auth.acceptInvite({
        token,
        username,
        password: form.password,
        name: form.name.trim(),
        role: form.role.trim(),
        email: form.email.trim() || undefined,
      });
      router.replace("/");
    } catch (err) {
      const status = statusOf(err);
      const emailTaken = status === 409 && err instanceof Error && /email/i.test(err.message);
      setError(emailTaken ? "Another account already uses that email." : status === 409 ? "That username is taken. Try another." : status === 404 || status === 410 ? "This invite has expired or was already used." : friendlyError(err, "join"));
      setBusy(false);
    }
  };

  if (lookup.kind === "loading") {
    return (
      <Centered>
        <div className="space-y-3" aria-busy aria-label="Checking your invite">
          <div className="h-8 w-40 animate-pulse rounded bg-raised" />
          <div className="h-4 w-64 animate-pulse rounded bg-raised" />
        </div>
      </Centered>
    );
  }
  if (lookup.kind !== "ok") {
    return (
      <Centered>
        <Logo size={24} />
        <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.02em]">{lookup.kind === "invalid" ? "This invite link doesn't work" : "Couldn't open this invite"}</h1>
        <p className="mt-2 text-sm text-muted">
          {lookup.kind === "invalid" ? "It may have expired or already been used. Ask your admin for a new one." : lookup.text}
        </p>
        <Link href="/" className="mt-5 inline-block text-sm text-muted underline-offset-4 hover:text-ink hover:underline">
          Already have an account? Sign in
        </Link>
      </Centered>
    );
  }

  return (
    <Centered>
      <Logo size={24} />
      <h1 className="mt-4 text-[24px] font-semibold tracking-[-0.03em]">Join {lookup.invite.orgName} on Orion</h1>
      <p className="mt-2 text-sm text-muted">Pick a username and password. This link expires {shortDate(lookup.invite.expiresAt)}.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <label className="block text-sm text-muted">
          Your name
          <input className={field} value={form.name} onChange={set("name")} autoComplete="name" required maxLength={80} />
        </label>
        <label className="block text-sm text-muted">
          What you do
          <input className={field} value={form.role} onChange={set("role")} placeholder="Account executive, backend engineer…" required maxLength={120} />
          <span className="mt-1 block text-[12px] text-faint">Orion shapes your dashboard around it.</span>
        </label>
        <label className="block text-sm text-muted">
          Work email (optional)
          <input className={field} type="email" value={form.email} onChange={set("email")} autoComplete="email" />
        </label>
        <label className="block text-sm text-muted">
          Username
          <input className={field} value={form.username} onChange={set("username")} autoComplete="username" autoCapitalize="none" spellCheck={false} required />
        </label>
        <label className="block text-sm text-muted">
          Password
          <input className={field} type="password" value={form.password} onChange={set("password")} autoComplete="new-password" minLength={8} required />
          <span className="mt-1 block text-[12px] text-faint">At least 8 characters.</span>
        </label>
        <FieldError id="invite-error" message={error} />
        <PrimaryButton type="submit" disabled={busy} className="w-full">
          {busy ? "Creating your account…" : "Join"}
        </PrimaryButton>
        <p className="text-[12px] text-faint">
          By joining you agree to your org&apos;s use of Orion. See the{" "}
          <Link href="/privacy" className="underline underline-offset-4 hover:text-ink">
            privacy policy
          </Link>
          .
        </p>
      </form>
    </Centered>
  );
}
