// Alerts to the operator's chat (ALERT_WEBHOOK_URL, a Slack or Discord incoming webhook): the disk filling up, the
// health check failing, and bursts of server errors. Each alert is sent at most once an hour. Alerts carry counts and
// route paths only, never captured text, titles or names. Whether the box is up at all needs an outside monitor on
// /api/health (docs/runbook.md), since a box that is down cannot report itself.
import fs from "node:fs";
import { config } from "@/config";
import { logJson } from "./log";

const HOUR = 3_600_000;
const ERROR_WINDOW_MS = 10 * 60_000;

export const alertEnv = {
  get webhook(): string | undefined {
    return process.env.ALERT_WEBHOOK_URL || undefined;
  },
  /** Disk use of DATA_DIR's volume, in percent, at which to alert. */
  get diskPercent(): number {
    const n = Number(process.env.ALERT_DISK_PERCENT);
    return n > 0 && n < 100 ? n : 85;
  },
  /** Server errors (5xx) within 10 minutes that make an alert. */
  get errorBurst(): number {
    const n = Number(process.env.ALERT_ERROR_BURST);
    return Number.isInteger(n) && n > 0 ? n : 10;
  },
};

const g = globalThis as typeof globalThis & { __orionAlerts?: { sent: Map<string, number>; errors: { at: number; path: string }[] } };
const state = () => (g.__orionAlerts ??= { sent: new Map(), errors: [] });

/** Sends `text` unless the same `key` was sent within the hour. True when sent. */
export async function alert(key: string, text: string, now = Date.now(), post: typeof fetch = fetch): Promise<boolean> {
  const url = alertEnv.webhook;
  const { sent } = state();
  if (!url || now - (sent.get(key) ?? -Infinity) < HOUR) return false;
  sent.set(key, now);
  logJson("warn", "alert", { key, text });
  const message = `Orion (${process.env.ORION_DOMAIN || "server"}): ${text}`;
  try {
    // Slack reads `text`, Discord `content`.
    await post(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: message, content: message }), signal: AbortSignal.timeout(10_000) });
    return true;
  } catch (err) {
    logJson("error", "alert webhook failed", { key, err });
    return false;
  }
}

/** Called for every 5xx response; a burst within 10 minutes alerts once. */
export function noteServerError(path: string, now = Date.now()): void {
  const s = state();
  s.errors = s.errors.filter((e) => now - e.at < ERROR_WINDOW_MS);
  s.errors.push({ at: now, path });
  if (s.errors.length < alertEnv.errorBurst) return;
  const paths = [...new Set(s.errors.map((e) => e.path))].slice(0, 5).join(", ");
  void alert("errors", `${s.errors.length} server errors in 10 minutes (${paths}). Logs: docker compose logs server, or journalctl -u orion-server.`, now);
}

/** Percent of the data volume in use, or null where statfs is unavailable. */
export function diskUsedPercent(dir = config.dataDir): number | null {
  try {
    const s = fs.statfsSync(dir);
    return s.blocks ? Math.round((1 - s.bavail / s.blocks) * 100) : null;
  } catch {
    return null;
  }
}

/** One watchdog pass: disk and health. `healthy` is the same check /api/health answers. */
export async function watchdogPass(healthy: () => { ok: boolean; failing: string[] }, now = Date.now()): Promise<void> {
  const used = diskUsedPercent();
  if (used !== null && used >= alertEnv.diskPercent) {
    await alert("disk", `the data disk is ${used}% full. Check retention and backups (docs/runbook.md, disk).`, now);
  }
  const h = healthy();
  if (!h.ok) await alert("health", `the health check is failing: ${h.failing.join(", ")}.`, now);
}
