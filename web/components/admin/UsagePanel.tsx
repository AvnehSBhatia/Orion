"use client";

import { Notice, Panel } from "@/components/ui/form";
import { api } from "@/lib/api/client";
import type { Usage } from "@/lib/api/types";
import { formatBytes } from "@/lib/format";
import { settingsError } from "@/lib/notLive";
import { useEffect, useState } from "react";

const usd = (n: number) => `$${n.toFixed(n < 10 ? 2 : 0)}`;
const num = (n: number) => n.toLocaleString("en-US");

export function UsagePanel({ orgId }: { orgId: string }) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api.orgs
      .usage(orgId)
      .then((u) => alive && setUsage(u))
      .catch((err) => alive && setError(settingsError(err, "read usage")));
    return () => {
      alive = false;
    };
  }, [orgId]);

  if (!usage) {
    return (
      <Panel title="Usage">
        {error ? <Notice kind="error">{error}</Notice> : <div className="h-40 animate-pulse rounded-lg bg-raised" aria-label="Loading usage" />}
      </Panel>
    );
  }
  const { llm, captures, storage } = usage;
  const share = llm.budgetUsd > 0 ? Math.min(1, llm.costUsd / llm.budgetUsd) : 0;
  const month = new Date(`${usage.month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <Panel title="Usage" description={`${month}, in UTC. Resets on the 1st.`}>
      <div className="rounded-xl border border-line bg-bg p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[14px] text-muted">AI spend</p>
          <p className="text-[14px] text-muted">
            <span className="text-[22px] font-semibold tracking-[-0.02em] text-ink">{usd(llm.costUsd)}</span>
            {llm.budgetUsd > 0 ? ` of ${usd(llm.budgetUsd)} budget` : " · no cap set"}
          </p>
        </div>
        {llm.budgetUsd > 0 && (
          <div
            className="mt-3 h-1.5 overflow-hidden rounded-full bg-raised"
            role="meter"
            aria-label="Share of monthly AI budget used"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(share * 100)}
          >
            <div className={share >= 0.9 ? "h-full bg-danger" : "h-full bg-ink"} style={{ width: `${share * 100}%` }} />
          </div>
        )}
        {share >= 1 && <p className="mt-2 text-[13px] text-danger">Budget reached. Chat and dashboard requests are paused until next month.</p>}
      </div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Model calls" value={num(llm.calls)} />
        <Stat label="Tokens in / out" value={`${num(llm.inputTokens)} / ${num(llm.outputTokens)}`} />
        <Stat label="Captures this month" value={num(captures.total)} />
        <Stat label="Storage" value={formatBytes(storage.bytes)} detail={`${formatBytes(storage.screenshotsBytes)} screenshots`} />
      </dl>
    </Panel>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-xl border border-line bg-bg p-4">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="mt-1 text-[18px] font-semibold tracking-[-0.02em] text-ink">{value}</dd>
      {detail && <dd className="text-[12px] text-faint">{detail}</dd>}
    </div>
  );
}
