"use client";

import { Centered } from "@/components/auth/Centered";
import { ConsentScreen } from "@/components/auth/ConsentScreen";
import { LoginForm } from "@/components/auth/LoginForm";
import { Logo } from "@/components/ui/Logo";
import { SessionContext } from "@/components/auth/session";
import { api, SIGNED_OUT_EVENT, statusOf } from "@/lib/api/client";
import type { Me } from "@/lib/api/types";
import { clearConversations, ORG_KEY, userKey, writeStored } from "@/lib/storage";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

type State =
  | { kind: "loading" }
  | { kind: "signed-out"; error?: string }
  | { kind: "signed-in"; me: Me }
  | { kind: "offline"; error: string };

/** The app's org and person pickers read these; point them at the signed-in account before the app mounts. */
function remember(me: Me) {
  if (!me.orgId || !me.userId) return;
  writeStored(ORG_KEY, me.orgId);
  writeStored(userKey(me.orgId), me.userId);
}

async function load(): Promise<State> {
  try {
    const me = await api.auth.me();
    remember(me);
    return { kind: "signed-in", me };
  } catch (err) {
    if (statusOf(err) === 401) return { kind: "signed-out" };
    return { kind: "offline", error: err instanceof Error ? err.message : String(err) };
  }
}

/** Shows the sign-in screen until /api/auth/me answers, then the app as the signed-in person. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  const check = useCallback(async () => setState(await load()), []);

  useEffect(() => {
    let alive = true;
    load().then((next) => alive && setState(next));
    const onSignedOut = () =>
      setState((s) => (s.kind === "signed-in" && s.me.authDisabled ? s : { kind: "signed-out", error: "Your session ended. Sign in again." }));
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => {
      alive = false;
      window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
    };
  }, []);

  const signOut = useCallback(async () => {
    await api.auth.logout().catch(() => {});
    clearConversations();
    setState({ kind: "signed-out" });
  }, []);

  const me = state.kind === "signed-in" ? state.me : null;
  const session = useMemo(() => (me ? { me, signOut, refresh: check } : null), [me, signOut, check]);

  if (state.kind === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg" role="status" aria-label="Loading Orion">
        <span className="animate-pulse">
          <Logo size={28} />
        </span>
      </div>
    );
  }
  if (state.kind === "offline") return <Offline onRetry={check} />;
  if (state.kind === "signed-out" || !session) return <LoginForm error={state.kind === "signed-out" ? state.error : undefined} onSignedIn={check} />;

  return (
    <SessionContext.Provider value={session}>
      <div key={session.me.username ?? "local"}>
        {session.me.consent?.required ? <ConsentScreen /> : children}
      </div>
    </SessionContext.Provider>
  );
}

/** The server could not be reached at load: say so plainly and keep retrying with backoff. */
function Offline({ onRetry }: { onRetry: () => Promise<void> }) {
  const [attempt, setAttempt] = useState(0);
  const delay = Math.min(30, 2 ** Math.min(attempt, 5));
  useEffect(() => {
    const t = window.setTimeout(() => {
      setAttempt((n) => n + 1);
      void onRetry();
    }, delay * 1000);
    return () => window.clearTimeout(t);
  }, [attempt, delay, onRetry]);
  return (
    <Centered>
      <Logo size={24} />
      <h1 className="mt-4 text-[20px] font-semibold tracking-[-0.02em]">Can&apos;t reach Orion</h1>
      <p className="mt-2 text-sm text-muted" role="status">
        The server isn&apos;t answering. This page tries again on its own in {delay} seconds.
      </p>
      <button type="button" onClick={() => void onRetry()} className="mt-5 h-10 rounded-md border border-line-strong px-4 text-sm text-ink hover:bg-raised">
        Try now
      </button>
    </Centered>
  );
}
