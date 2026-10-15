"use client";

import type { Me } from "@/lib/api/types";
import { createContext, useContext } from "react";

export type Session = {
  me: Me;
  /** Signs out and shows the sign-in screen. */
  signOut: () => Promise<void>;
  /** Re-reads /api/auth/me (after consent or a password change). */
  refresh: () => Promise<void>;
};

export const SessionContext = createContext<Session | null>(null);

/** The signed-in account. Only valid under <AuthGate>. */
export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession outside <AuthGate>");
  return session;
}
