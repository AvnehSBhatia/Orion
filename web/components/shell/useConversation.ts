"use client";

// One conversation per person for the browser session (switching people swaps it), plus the opening brief.

import { api } from "@/lib/api/client";
import type { Message } from "@/lib/chat";
import { conversationKey, readSession, writeSession } from "@/lib/storage";
import { type SetStateAction, useEffect, useRef, useState } from "react";

function load(key: string): Message[] {
  try {
    const raw = readSession(key);
    return raw ? (JSON.parse(raw) as Message[]).filter((item) => !item.pending && !item.failed && typeof item.text === "string") : [];
  } catch {
    return [];
  }
}

export function useConversation({
  orgId,
  userId,
  briefNow,
  onBrief,
}: {
  orgId: string | null;
  userId: string | null;
  /** The app is open (not the intro), so the brief can be shown. */
  briefNow: boolean;
  onBrief?: () => void;
}) {
  const key = orgId && userId ? conversationKey(orgId, userId) : null;
  const [conv, setConv] = useState<{ key: string | null; messages: Message[] }>({ key: null, messages: [] });
  // A new person: swap in their conversation during render, so no frame shows the previous one's.
  // The first load keeps anything asked before the person was known.
  if (key && conv.key !== key) {
    const stored = load(key);
    setConv({ key, messages: conv.key === null && !stored.length ? conv.messages : stored });
  }
  const messages = conv.messages;
  const setMessages = (next: SetStateAction<Message[]>) =>
    setConv((current) => ({ ...current, messages: typeof next === "function" ? next(current.messages) : next }));

  useEffect(() => {
    if (!conv.key) return;
    writeSession(conv.key, JSON.stringify(conv.messages.filter((item) => !item.pending && !item.failed).slice(-40)));
  }, [conv]);

  const askedHere = useRef(false);
  const keyRef = useRef(key);
  const onBriefRef = useRef(onBrief);
  useEffect(() => {
    keyRef.current = key;
    onBriefRef.current = onBrief;
  });

  // Once per person per page load, when the app opens: what moved for them, as Orion's first word.
  const briefed = useRef(new Set<string>());
  useEffect(() => {
    if (!briefNow || !orgId || !userId || !key || briefed.current.has(key)) return;
    briefed.current.add(key);
    api
      .brief(orgId, userId)
      .then(({ text, sources }) => {
        if (!text || keyRef.current !== key) return;
        const brief: Message = { role: "assistant", text, sources, brief: true };
        onBriefRef.current?.();
        setConv((conv) => {
          const current = conv.messages;
          const rest = current.filter((item) => !item.brief);
          // Ahead of a question still being answered (or already answered on this page), so the answer stays last.
          const pending = rest.findIndex((item) => item.pending);
          const asked = askedHere.current ? rest.findLastIndex((item) => item.role === "user") + 1 : -1;
          const at = pending >= 0 ? pending : asked > 0 ? asked : -1;
          if (at < 0) return { ...conv, messages: [...rest, brief] };
          const cut = Math.max(0, at - 1);
          return { ...conv, messages: [...rest.slice(0, cut), brief, ...rest.slice(cut)] };
        });
      })
      .catch(() => {});
  }, [briefNow, orgId, userId, key]);

  /** A question was asked on this page, so a late brief goes in before it rather than after. */
  const noteAsked = () => {
    askedHere.current = true;
  };

  return { messages, setMessages, noteAsked };
}
