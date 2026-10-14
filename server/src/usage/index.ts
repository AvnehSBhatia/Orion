// Model usage per org: every call recorded with its tokens and cost, rolled up per month, and the monthly budget
// enforced before a call goes out.
import fs from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Store } from "@/db/store";
import { HttpError } from "@/http/error";
import { getOrgSettings } from "@/orgs/settings";
import { estimateCost } from "./prices";

export { estimateCost, priceFor } from "./prices";

/** The org's monthly model budget is spent. Routes answer 402; ingest stores the document without extraction. */
export class BudgetExceededError extends HttpError {
  readonly budgetExceeded = true;
  constructor() {
    super(402, "monthly model budget reached");
  }

  /** By shape, like HttpError, so a copy of this module from another bundle still matches. */
  static override [Symbol.hasInstance](v: unknown): boolean {
    return v instanceof HttpError && (v as { budgetExceeded?: unknown }).budgetExceeded === true;
  }
}

type Ctx = { store: Store };
// One instance per process even when this module is loaded twice (dev reloads, separate route bundles).
const g = globalThis as typeof globalThis & { __orionUsage?: AsyncLocalStorage<Ctx> };
const als = (g.__orionUsage ??= new AsyncLocalStorage<Ctx>());

/**
 * Runs `fn` with model calls billed to this org: each OpenRouter call made inside (awaited or not) checks the
 * org's budget first and records its usage after. Calls made outside any org context are not metered.
 */
export function withUsage<T>(store: Store, fn: () => T): T {
  return als.run({ store }, fn);
}

/** The org the current model call is billed to, if any. */
export function usageStore(): Store | null {
  return als.getStore()?.store ?? null;
}

export type UsageKind = "chat" | "extract" | "embed";

export type ModelUsage = {
  model: string;
  kind: UsageKind;
  inputTokens: number;
  outputTokens: number;
  /** OpenRouter's own figure (usage.cost) when it returned one; else estimated from the price table. */
  costUsd?: number | null;
};

export type MonthUsage = { calls: number; inputTokens: number; outputTokens: number; costUsd: number };

const ready = new WeakSet<object>();

function ensureTable(store: Store): void {
  if (ready.has(store.db)) return;
  store.db.exec(`CREATE TABLE IF NOT EXISTS llm_usage (
    day TEXT NOT NULL,
    model TEXT NOT NULL,
    kind TEXT NOT NULL,
    calls INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (day, model, kind)
  )`);
  ready.add(store.db);
}

/** "2026-10" for a UTC date. */
export const monthOf = (d = new Date()) => d.toISOString().slice(0, 7);

export function recordUsage(store: Store, u: ModelUsage, now = new Date()): void {
  ensureTable(store);
  const cost = typeof u.costUsd === "number" && Number.isFinite(u.costUsd) ? u.costUsd : estimateCost(u.model, u.inputTokens, u.outputTokens);
  store.db
    .prepare(
      `INSERT INTO llm_usage (day, model, kind, calls, input_tokens, output_tokens, cost_usd) VALUES (?, ?, ?, 1, ?, ?, ?)
       ON CONFLICT(day, model, kind) DO UPDATE SET calls = calls + 1, input_tokens = input_tokens + excluded.input_tokens,
         output_tokens = output_tokens + excluded.output_tokens, cost_usd = cost_usd + excluded.cost_usd`,
    )
    .run(now.toISOString().slice(0, 10), u.model, u.kind, Math.max(0, u.inputTokens | 0), Math.max(0, u.outputTokens | 0), Math.max(0, cost));
}

export function monthUsage(store: Store, month = monthOf()): MonthUsage {
  ensureTable(store);
  const r = store.db
    .prepare(
      `SELECT IFNULL(SUM(calls), 0) AS calls, IFNULL(SUM(input_tokens), 0) AS input, IFNULL(SUM(output_tokens), 0) AS output,
         IFNULL(SUM(cost_usd), 0) AS cost FROM llm_usage WHERE day LIKE ? || '-%'`,
    )
    .get(month) as { calls: number; input: number; output: number; cost: number };
  return { calls: r.calls, inputTokens: r.input, outputTokens: r.output, costUsd: Math.round(r.cost * 1e6) / 1e6 };
}

/** True when the org has a budget and this month's spend reached it. */
export function overBudget(store: Store, now = new Date()): boolean {
  const budget = getOrgSettings(store).llmMonthlyBudgetUsd;
  return budget > 0 && monthUsage(store, monthOf(now)).costUsd >= budget;
}

/** Throws BudgetExceededError when the org is over its monthly budget. */
export function assertBudget(store: Store, now = new Date()): void {
  if (overBudget(store, now)) throw new BudgetExceededError();
}

/** Called by the model client before each billable call: checks the budget of the org in context, if any. */
export function beforeModelCall(): void {
  const store = usageStore();
  if (store) assertBudget(store);
}

/** Called by the model client after each call with the response's usage. Never throws. */
export function afterModelCall(u: ModelUsage): void {
  const store = usageStore();
  if (!store) return;
  try {
    recordUsage(store, u);
  } catch (err) {
    console.error("recording model usage failed", err);
  }
}

/** OpenAI-style `usage` from an OpenRouter response, as our fields. */
export function readUsage(raw: unknown): { inputTokens: number; outputTokens: number; costUsd: number | null } | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown; cost?: unknown };
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const input = u.prompt_tokens !== undefined ? n(u.prompt_tokens) : Math.max(0, n(u.total_tokens) - n(u.completion_tokens));
  return { inputTokens: input, outputTokens: n(u.completion_tokens), costUsd: typeof u.cost === "number" ? u.cost : null };
}

export type UsageReport = {
  month: string;
  llm: MonthUsage & { budgetUsd: number };
  captures: { month: number; total: number };
  storage: { bytes: number; screenshotsBytes: number };
};

function fileSize(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

/** The body of GET /api/orgs/:orgId/usage. */
export function usageReport(store: Store, now = new Date()): UsageReport {
  const month = monthOf(now);
  const since = `${month}-01T00:00:00.000Z`;
  const captures = store.db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM sources WHERE kind = 'extension' AND created_at >= ?) AS month,
              (SELECT COUNT(*) FROM sources WHERE kind = 'extension') AS total`,
    )
    .get(since) as { month: number; total: number };
  const shots = store.db.prepare("SELECT IFNULL(SUM(length(image)), 0) AS n FROM sources WHERE image IS NOT NULL").get() as { n: number };
  const file = store.db.name;
  const pages = (store.db.pragma("page_count", { simple: true }) as number) * (store.db.pragma("page_size", { simple: true }) as number);
  const bytes = file && file !== ":memory:" ? Math.max(fileSize(file), pages) + fileSize(`${file}-wal`) : pages;
  return {
    month,
    llm: { ...monthUsage(store, month), budgetUsd: getOrgSettings(store).llmMonthlyBudgetUsd },
    captures,
    storage: { bytes, screenshotsBytes: shots.n },
  };
}
