"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Polls `load` every `ms` while mounted; re-runs immediately when `key` changes. Keeps the last good value on
 * error, and reports when that value arrived so the page can say how stale it is.
 */
export function usePoll<T>(key: string | null, load: () => Promise<T>, ms: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  useEffect(() => {
    if (!key) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const v = await loadRef.current();
        if (alive) {
          setData(v);
          setError(null);
          setUpdatedAt(Date.now());
        }
      } catch (e) {
        if (alive) setError(e ?? new Error("failed"));
      }
      if (alive) timer = setTimeout(tick, ms);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [key, ms]);
  return { data, error, updatedAt, setData };
}
