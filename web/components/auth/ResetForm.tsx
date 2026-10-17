"use client";

// Public: set a new password from an admin's one-time reset link.

import { Centered } from "@/components/auth/Centered";
import { field, FieldError, PrimaryButton } from "@/components/ui/form";
import { Logo } from "@/components/ui/Logo";
import { api, statusOf } from "@/lib/api/client";
import { friendlyError } from "@/lib/errors";
import Link from "next/link";
import { type FormEvent, useState } from "react";

export function ResetForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirm) return setError("The passwords don't match.");
    setBusy(true);
    try {
      await api.auth.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      const status = statusOf(err);
      setError(status === 404 || status === 410 || status === 400 ? "This reset link has expired or was already used. Ask your admin for a new one." : friendlyError(err, "reset your password"));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Centered>
        <Logo size={24} />
        <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.02em]">Password changed</h1>
        <p className="mt-2 text-sm text-muted" role="status">
          You can sign in with your new password now.
        </p>
        <Link href="/" className="mt-5 inline-block rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-bg">
          Sign in
        </Link>
      </Centered>
    );
  }

  return (
    <Centered>
      <Logo size={24} />
      <h1 className="mt-4 text-[24px] font-semibold tracking-[-0.03em]">Choose a new password</h1>
      <p className="mt-2 text-sm text-muted">This link works once. Your other sessions are signed out.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <label className="block text-sm text-muted">
          New password
          <input className={field} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required autoFocus />
          <span className="mt-1 block text-[12px] text-faint">At least 8 characters.</span>
        </label>
        <label className="block text-sm text-muted">
          Confirm new password
          <input className={field} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        </label>
        <FieldError id="reset-error" message={error} />
        <PrimaryButton type="submit" disabled={busy} className="w-full">
          {busy ? "Saving…" : "Set password"}
        </PrimaryButton>
      </form>
    </Centered>
  );
}
