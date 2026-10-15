"use client";

import { Centered } from "@/components/auth/Centered";
import { api } from "@/lib/api/client";
import { type FormEvent, useState } from "react";

export function LoginForm({ error, onSignedIn }: { error?: string; onSignedIn: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(error ?? "");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await api.auth.login(username.trim(), password);
      setPassword("");
      onSignedIn();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const field = "mt-1.5 h-11 w-full rounded-md border border-line-strong bg-panel px-3 text-base text-ink outline-none focus:border-ink";
  return (
    <Centered>
      <h1 className="font-display text-4xl">Orion</h1>
      <p className="mt-2 text-sm text-muted">Sign in to see your org.</p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <label className="block text-sm text-muted">
          Username
          <input className={field} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus />
        </label>
        <label className="block text-sm text-muted">
          Password
          <input className={field} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {message && (
          <p role="alert" className="text-sm text-ink">
            {message}
          </p>
        )}
        <button type="submit" disabled={busy} className="h-11 w-full rounded-md bg-ink text-sm font-medium text-bg disabled:opacity-60">
          {busy ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </Centered>
  );
}
