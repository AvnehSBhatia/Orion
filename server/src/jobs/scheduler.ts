// In-process background jobs: retention every hour and extraction retries every few minutes, over every org on
// disk, one org at a time. Assumes one server process per DATA_DIR (as the rest of the server does).
import fs from "node:fs";
import path from "node:path";
import type { Store } from "@/db/store";
import { duePendingCount } from "@/ingest/extraction";
import { runRetention } from "@/retention";
import { logJson, safely } from "./log";

export type JobDeps = {
  /** Org ids to visit. */
  orgIds: () => string[];
  /** Opens an org's store; may throw for an org deleted meanwhile. */
  store: (orgId: string) => Store;
  /** Schedules org maintenance, which retries due extractions first. */
  maintain: (store: Store) => void;
};

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const jobEnv = {
  get retentionEveryMs(): number {
    return num(process.env.RETENTION_INTERVAL_MS, 3_600_000);
  },
  get extractionRetryEveryMs(): number {
    return num(process.env.EXTRACTION_RETRY_INTERVAL_MS, 5 * 60_000);
  },
  /** Delay after boot before the first pass, so startup is not slowed. */
  get firstRunDelayMs(): number {
    return num(process.env.JOBS_FIRST_RUN_MS, 2 * 60_000);
  },
};

/** Org ids with a file under `${dataDir}/orgs`. Never creates or seeds an org. */
export function orgIdsOnDisk(dataDir: string): string[] {
  const dir = path.join(dataDir, "orgs");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".db"))
    .map((f) => f.slice(0, -3))
    .sort();
}

/** A job that never overlaps itself: a tick that arrives while the last run is still going is skipped. */
function serial(name: string, run: () => Promise<void>) {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      await safely(name, run);
    } finally {
      running = false;
    }
  };
}

/** One retention pass over every org, one at a time, yielding between orgs so requests keep flowing. */
export async function retentionPass(deps: JobDeps, now = Date.now()): Promise<void> {
  for (const orgId of deps.orgIds()) {
    const report = await safely("retention", () => runRetention(deps.store(orgId), now), { orgId });
    if (report && (report.documentsDeleted || report.screenshotsExpired || report.screenshotsEvicted || report.digestsDeleted)) {
      logJson("info", "retention", { orgId, ...report });
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Starts maintenance for every org with extractions due for a retry. */
export async function extractionRetryPass(deps: JobDeps, now = Date.now()): Promise<void> {
  for (const orgId of deps.orgIds()) {
    await safely(
      "extraction retry",
      () => {
        const store = deps.store(orgId);
        if (duePendingCount(store, now) > 0) deps.maintain(store);
      },
      { orgId },
    );
  }
}

type Running = { timers: NodeJS.Timeout[] };
const g = globalThis as typeof globalThis & { __orionJobs?: Running };

/** Starts the timers once per process (a dev reload does not start a second set). Returns a stop function. */
export function startScheduler(deps: JobDeps): () => void {
  if (g.__orionJobs) return () => stopScheduler();
  const retention = serial("retention", () => retentionPass(deps));
  const retries = serial("extraction retry", () => extractionRetryPass(deps));
  const timers: NodeJS.Timeout[] = [];
  const first = setTimeout(() => {
    void retention();
    void retries();
    timers.push(setInterval(retention, jobEnv.retentionEveryMs), setInterval(retries, jobEnv.extractionRetryEveryMs));
    timers.forEach((t) => t.unref?.());
  }, jobEnv.firstRunDelayMs);
  first.unref?.();
  timers.push(first);
  g.__orionJobs = { timers };
  logJson("info", "background jobs started", { retentionEveryMs: jobEnv.retentionEveryMs, extractionRetryEveryMs: jobEnv.extractionRetryEveryMs });
  return () => stopScheduler();
}

export function stopScheduler(): void {
  for (const t of g.__orionJobs?.timers ?? []) clearTimeout(t);
  g.__orionJobs = undefined;
}
