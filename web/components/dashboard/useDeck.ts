"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type Bank, DECK_SIZE, LIVE_KINDS } from "./cardBank";

const ROTATE_MS = 6000;
export const GLOW_MS = 1500;

/**
 * Which non-pinned bank cards are on screen. Resets to the top of the ranking when the spec changes,
 * lets fresh live data push in at its rank, and rotates the lowest ones on a timer unless paused.
 */
export function useDeck(bank: Bank, key: string, paused: React.RefObject<boolean>) {
  const [ids, setIds] = useState<string[]>([]);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const bankRef = useRef(bank);
  const visRef = useRef<string[]>([]);
  const keyRef = useRef<string | null>(null);
  const readyRef = useRef(0);
  const sigRef = useRef<Map<string, string> | null>(null);
  const cursor = useRef(0);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const glow = useCallback((add: string[]) => {
    if (!add.length) return;
    setFresh((prev) => {
      const n = new Set(prev);
      for (const id of add) n.add(id);
      return n;
    });
    for (const id of add) {
      clearTimeout(timers.current.get(id));
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id);
          setFresh((prev) => {
            if (!prev.has(id)) return prev;
            const n = new Set(prev);
            n.delete(id);
            return n;
          });
        }, GLOW_MS),
      );
    }
  }, []);

  useEffect(() => {
    const t = timers.current;
    return () => t.forEach((x) => clearTimeout(x));
  }, []);

  const commit = useCallback((next: string[]) => {
    visRef.current = next;
    setIds(next);
  }, []);

  // Reconcile before paint so a spec change never flashes more than ten cards.
  useLayoutEffect(() => {
    bankRef.current = bank;
    const slots = Math.max(0, DECK_SIZE - bank.pinned.length);
    const rank = new Map(bank.ranked.map((c, i) => [c.id, i]));
    const prevSig = sigRef.current;
    sigRef.current = new Map(bank.ranked.map((c) => [c.id, c.sig]));
    const cur = visRef.current;
    // Data readiness: the first real graph or activity payload re-ranks too, without glowing everything.
    const ready = bank.ranked.length >= DECK_SIZE ? 2 : bank.ranked.length > 0 ? 1 : 0;
    const readyChanged = ready !== readyRef.current;
    readyRef.current = ready;

    if (keyRef.current !== key || readyChanged) {
      const asked = keyRef.current !== null && keyRef.current !== key;
      keyRef.current = key;
      cursor.current = 0;
      const next = bank.ranked.slice(0, slots).map((c) => c.id);
      commit(next);
      if (asked) glow(next.filter((id) => !cur.includes(id)));
      return;
    }

    let next = cur.filter((id) => rank.has(id));
    const entering: string[] = [];
    const worstLight = () => {
      let worst: string | null = null;
      for (const id of next) {
        const c = bank.ranked[rank.get(id)!];
        if (c.heavy) continue;
        if (worst === null || rank.get(id)! > rank.get(worst)!) worst = id;
      }
      return worst;
    };
    if (prevSig && prevSig.size) {
      const arrivals = bank.ranked.filter((c) => LIVE_KINDS.has(c.kind) && prevSig.get(c.id) !== c.sig).slice(0, 2);
      for (const a of arrivals) {
        if (next.includes(a.id)) {
          entering.push(a.id);
          continue;
        }
        if (next.length < slots) {
          next.push(a.id);
          entering.push(a.id);
          continue;
        }
        const worst = worstLight();
        if (worst && rank.get(a.id)! < rank.get(worst)!) {
          next = next.filter((id) => id !== worst).concat(a.id);
          entering.push(a.id);
        }
      }
    }
    for (const c of bank.ranked) {
      if (next.length >= slots) break;
      if (!next.includes(c.id)) next.push(c.id);
    }
    if (next.length > slots) next = [...next].sort((a, b) => rank.get(a)! - rank.get(b)!).slice(0, slots);
    if (next.length !== cur.length || next.some((id, i) => id !== cur[i])) commit(next);
    glow(entering.filter((id) => next.includes(id)));
  }, [bank, key, commit, glow]);

  // Rotate the bottom of the deck: 1 then 2 cards, alternating.
  useEffect(() => {
    let two = false;
    const t = setInterval(() => {
      if (paused.current || document.hidden) return;
      const b = bankRef.current;
      const cur = visRef.current;
      const vis = new Set(cur);
      const pool = b.ranked.filter((c) => !vis.has(c.id) && !c.heavy);
      if (!pool.length) return;
      const rank = new Map(b.ranked.map((c, i) => [c.id, i]));
      const light = cur.filter((id) => rank.has(id) && !b.ranked[rank.get(id)!].heavy);
      two = !two;
      const n = Math.min(two ? 2 : 1, pool.length, Math.max(0, light.length - 1));
      if (n <= 0) return;
      const out = new Set([...light].sort((a, z) => rank.get(z)! - rank.get(a)!).slice(0, n));
      const ins: string[] = [];
      for (let k = 0; k < pool.length && ins.length < n; k++) {
        const id = pool[cursor.current++ % pool.length].id;
        if (!ins.includes(id)) ins.push(id);
      }
      commit(cur.filter((id) => !out.has(id)).concat(ins));
      glow(ins);
    }, ROTATE_MS);
    return () => clearInterval(t);
  }, [paused, commit, glow]);

  return { ids, fresh };
}
