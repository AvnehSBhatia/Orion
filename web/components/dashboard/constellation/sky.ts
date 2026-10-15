"use client";

// Module-level cache of each org's embedding projection, shared by the constellation and the topic cards.

import { api } from "@/lib/api/client";
import type { EmbeddingsResponse } from "@/lib/api/types";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

const POLL_MS = 5000;

// Survives remounts (the dashboard reshapes often), so a returning
// constellation paints instantly from the last projection while a fresh one loads.
const sky = new Map<string, { data: EmbeddingsResponse; at: number }>();
const inflight = new Map<string, Promise<EmbeddingsResponse>>();
const listeners = new Map<string, Set<(d: EmbeddingsResponse) => void>>();

/** Fetch (deduped) and cache the org's projection. Safe to call early, e.g. as soon as the orgId is known. */
export function prefetchSky(orgId: string): Promise<EmbeddingsResponse> {
  const running = inflight.get(orgId);
  if (running) return running;
  const p = api
    .embeddings(orgId)
    .then((data) => {
      sky.set(orgId, { data, at: Date.now() });
      listeners.get(orgId)?.forEach((fn) => fn(data));
      return data;
    })
    .finally(() => inflight.delete(orgId));
  inflight.set(orgId, p);
  return p;
}

const skySig = (d: EmbeddingsResponse | null) => (d ? `${d.points.length}|${d.clusters.map((c) => `${c.id}:${c.size}`).join(",")}` : "");

// Snapshot per org that only changes identity when the clusters do, so readers do not re-render on every poll.
const stableSky = new Map<string, EmbeddingsResponse>();
function readStableSky(orgId: string): EmbeddingsResponse | null {
  const d = sky.get(orgId)?.data ?? null;
  const s = stableSky.get(orgId) ?? null;
  if (d && skySig(d) !== skySig(s)) {
    stableSky.set(orgId, d);
    return d;
  }
  return s;
}

/** Read the cached projection without fetching. Re-renders only when the clusters actually change. */

/** Read the cached projection without fetching. Re-renders only when the clusters actually change. */
export function useSkySnapshot(orgId: string): EmbeddingsResponse | null {
  const subscribe = useCallback(
    (cb: () => void) => {
      let set = listeners.get(orgId);
      if (!set) listeners.set(orgId, (set = new Set()));
      const fn = () => cb();
      set.add(fn);
      return () => {
        set.delete(fn);
      };
    },
    [orgId],
  );
  return useSyncExternalStore(
    subscribe,
    () => (orgId ? readStableSky(orgId) : null),
    () => null,
  );
}

export function useSky(orgId: string) {
  // Tagged with the org it was loaded for, so switching org reads that org's cache instead of the old sky.
  const [state, setState] = useState<{ orgId: string; data: EmbeddingsResponse | null }>(() => ({
    orgId,
    data: orgId ? (sky.get(orgId)?.data ?? null) : null,
  }));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const fn = (d: EmbeddingsResponse) => {
      if (!alive) return;
      setState({ orgId, data: d });
      setError(null);
    };
    let set = listeners.get(orgId);
    if (!set) listeners.set(orgId, (set = new Set()));
    set.add(fn);
    const tick = async () => {
      try {
        await prefetchSky(orgId);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
      if (alive) timer = setTimeout(tick, POLL_MS);
    };
    const cached = sky.get(orgId);
    if (cached && Date.now() - cached.at < POLL_MS) timer = setTimeout(tick, POLL_MS - (Date.now() - cached.at));
    else tick();
    return () => {
      alive = false;
      clearTimeout(timer);
      set.delete(fn);
    };
  }, [orgId]);
  const data = state.orgId === orgId ? state.data : orgId ? (sky.get(orgId)?.data ?? null) : null;
  return { data, error };
}

