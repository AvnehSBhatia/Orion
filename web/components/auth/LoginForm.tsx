"use client";

import { Centered } from "@/components/auth/Centered";
import { field, FieldError, Notice, PrimaryButton } from "@/components/ui/form";
import { api, statusOf } from "@/lib/api/client";
import { friendlyError } from "@/lib/errors";
import Link from "next/link";
import { type FormEvent, useState } from "react";

export function LoginForm({ error, onSignedIn }: { error?: string; onSignedIn: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(error ?? "");
  const [forgot, setForgot] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await api.auth.login(username.trim(), password);
      setPassword("");
      onSignedIn();
    } catch (err) {
      const status = statusOf(err);
      setMessage(status === 401 || status === 400 ? "That email or username and password don't match. Try again." : friendlyError(err, "sign in"));
    } finally {
      setBusy(false);
    }
  };

  const invalid = !!message && !error;
  return (
    <Centered>
      <h1 className="font-display text-4xl">Orion</h1>
      <p className="mt-2 text-sm text-muted">Sign in to see your org.</p>
      <form onSubmit={submit} className="mt-8 space-y-4" noValidate={false}>
        <label className="block text-sm text-muted">
          Email or username
          <input
            className={field}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            autoFocus
            aria-invalid={invalid || undefined}
            aria-describedby={message ? "login-error" : undefined}
          />
        </label>
        <label className="block text-sm text-muted">
          Password
          <input
            className={field}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            aria-invalid={invalid || undefined}
            aria-describedby={message ? "login-error" : undefined}
          />
        </label>
        <FieldError id="login-error" message={message} />
        <PrimaryButton type="submit" disabled={busy} className="w-full">
          {busy ? "Signing in…" : "Sign in"}
        </PrimaryButton>
      </form>
      <div className="mt-6 space-y-3 text-[13px] text-muted">
        <button type="button" onClick={() => setForgot((v) => !v)} aria-expanded={forgot} className="underline-offset-4 hover:text-ink hover:underline">
          Forgot your password?
        </button>
        {forgot && <ForgotForm initialEmail={username.includes("@") ? username.trim() : ""} />}
        <p>
          New to Orion? Ask your admin for an invite link.{" "}
          <Link href="/privacy" className="underline-offset-4 hover:text-ink hover:underline">
            Privacy
          </Link>
        </p>
      </div>
    </Centered>
  );
}

/** Emails a reset link. The answer is the same whether or not an account uses the email. */
function ForgotForm({ initialEmail }: { initialEmail: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "sent" | "no_mail" | "error"; text: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const answer = await api.auth.forgot(email.trim());
      setResult(
        answer.sent === "not_configured"
          ? { kind: "no_mail", text: "This server can't send email. Ask an admin in your org for a reset link (Admin, People, Reset link)." }
          : { kind: "sent", text: "If an account uses that email, we sent it a reset link. It works once and expires in 24 hours." },
      );
    } catch (err) {
      setResult({ kind: "error", text: statusOf(err) === 400 ? "Enter the email address you use for Orion." : friendlyError(err, "send a reset link") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-line bg-panel px-3 py-3">
      <label className="block text-[13px] text-muted">
        Your email
        <input className={field} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
      </label>
      {result && <Notice kind={result.kind === "error" ? "error" : "ok"}>{result.text}</Notice>}
      {result?.kind !== "sent" && result?.kind !== "no_mail" && (
        <PrimaryButton type="submit" disabled={busy} className="w-full">
          {busy ? "Sending…" : "Email me a reset link"}
        </PrimaryButton>
      )}
    </form>
  );
}
