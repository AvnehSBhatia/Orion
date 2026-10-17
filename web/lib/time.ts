"use client";

import { useEffect, useState } from "react";

const DAY = 86_400_000;

/** "Oct 16", with the year when it is not this year ("Oct 16, 2027"), so a date a year out never reads as today. */
export function shortDate(iso: string, now = new Date()) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(d.getFullYear() !== now.getFullYear() && { year: "numeric" }) });
}

/** Sentence form: "4s ago", "3 min ago", "yesterday", "Oct 2". `now` is passed in so callers can tick it. */
export function ago(iso: string, now = Date.now()) {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.floor((now - then) / DAY);
  if (days < 2) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  return shortDate(iso);
}

/** Compact form for dense rows: "now", "42s", "7m", "3h", "2d". */
export function agoShort(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(s)) return "";
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** The compact form as a phrase: "just now", "7m ago". */
export function since(iso: string, now = Date.now()) {
  const a = agoShort(iso, now);
  return a === "now" ? "just now" : a ? `${a} ago` : "";
}

/** Re-renders every `ms` so relative times stay honest without refetching. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(timer);
  }, [ms]);
  return now;
}
