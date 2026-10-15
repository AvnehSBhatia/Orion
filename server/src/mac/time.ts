// Local days in an IANA time zone, without a date library: Intl does the zone math.

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The zone if Intl knows it, else UTC. Returns Intl's canonical spelling, so case variants cannot each fill the formatter cache. */
export function validZone(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz }).resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function parts(at: Date, tz: string): Record<string, number> {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formatters.set(tz, f);
  }
  const out: Record<string, number> = {};
  for (const p of f.formatToParts(at)) if (p.type !== "literal") out[p.type] = Number(p.value);
  return out;
}

/** "2026-10-14": the calendar day of `at` in `tz`. */
export function localDay(at: Date, tz: string): string {
  const p = parts(at, tz);
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Milliseconds `tz` is ahead of UTC at `at`. */
function offsetMs(at: Date, tz: string): number {
  const p = parts(at, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at.getTime() / 1000) * 1000;
}

/** The UTC instant local midnight of `day` falls on in `tz` (DST-safe: the offset is re-read at the guess). */
export function startOfLocalDay(day: string, tz: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let at = guess - offsetMs(new Date(guess), tz);
  at = guess - offsetMs(new Date(at), tz);
  return new Date(at);
}

/** [start, end) of a local day as UTC ISO strings. */
export function localDayRange(day: string, tz: string): { from: string; to: string } {
  const [y, m, d] = day.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return { from: startOfLocalDay(day, tz).toISOString(), to: startOfLocalDay(next, tz).toISOString() };
}

export function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let day = from; day <= to && out.length < 400; day = addDays(day, 1)) out.push(day);
  return out;
}
