"use client";

import { useCallback, useState } from "react";

export type Toast = { id: number; text: string; kind: "info" | "dashboard" };

/** Short notices under the header; at most three, each gone after a few seconds. */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current.slice(-2), { id, text, kind }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), kind === "dashboard" ? 6000 : 4500);
  }, []);
  return { toasts, notify };
}
