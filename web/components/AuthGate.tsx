"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { SIGNED_OUT_EVENT, auth, type Me } from "@/lib/orion";

type State = { kind: "loading" } | { kind: "signed-out"; error?: string } | { kind: "signed-in"; me: Me } | { kind: "offline"; error: string };

/** The app's org and person pickers read these; point them at the signed-in account before the app mounts. */
function remember(me: Me) {
  if (!me.orgId || !me.userId) return;
  try {
    localStorage.setItem("orion.org", me.orgId);
    localStorage.setItem(`orion.user.${me.orgId}`, me.userId);
  } catch {}
}

/** Shows the sign-in screen until /api/auth/me answers, then the app as the signed-in person. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  const check = useCallback(async () => {
    try {
      const me = await auth.me();
      remember(me);
      setState({ kind: "signed-in", me });
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401) setState({ kind: "signed-out" });
      else setState({ kind: "offline", error: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  useEffect(() => {
    check();
    const onSignedOut = () => setState((s) => (s.kind === "signed-in" && s.me.authDisabled ? s : { kind: "signed-out", error: "Your session ended. Sign in again." }));
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
  }, [check]);

  if (state.kind === "loading") return <div className="min-h-dvh bg-bg" />;
  if (state.kind === "offline") {
    return (
      <Centered>
        <p className="text-sm text-muted">Could not reach the Orion server: {state.error}</p>
        <button type="button" onClick={check} className="mt-4 h-10 rounded-md border border-line-strong px-4 text-sm text-ink hover:bg-raised">
          Try again
        </button>
      </Centered>
    );
  }
  if (state.kind === "signed-out") return <LoginForm error={state.error} onSignedIn={check} />;

  const { me } = state;
  return (
    <>
      <div key={me.username ?? "local"}>{children}</div>
      {!me.authDisabled && (
        <button
          type="button"
          onClick={async () => {
            await auth.logout().catch(() => {});
            setState({ kind: "signed-out" });
          }}
          className="fixed bottom-3 left-3 z-50 rounded-md px-2 py-1 text-xs text-faint hover:text-ink"
          title={`Signed in as ${me.username}`}
        >
          Sign out {me.username}
        </button>
      )}
    </>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-4 text-ink">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}

function LoginForm({ error, onSignedIn }: { error?: string; onSignedIn: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(error ?? "");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await auth.login(username.trim(), password);
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
