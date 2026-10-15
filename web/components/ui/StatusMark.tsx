import type { StarStatus } from "@/lib/stars";
import type { Status } from "@/lib/status";

export function StatusMark({ status, size = 12 }: { status: StarStatus; size?: number }) {
  const r = size / 2 - 1;
  const c = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" aria-hidden>
      {status === "on_track" && <circle cx={c} cy={c} r={r} fill="#ededed" />}
      {status === "at_risk" && (
        <>
          <circle cx={c} cy={c} r={r} fill="none" stroke="#ededed" strokeWidth={1.5} />
          <circle cx={c} cy={c} r={r / 2.4} fill="#ededed" />
        </>
      )}
      {status === "blocked" && (
        <circle cx={c} cy={c} r={r} fill="none" stroke="#ededed" strokeWidth={1.5} strokeDasharray="2 2" />
      )}
      {status === "done" && <circle cx={c} cy={c} r={r} fill="#5a5a5a" />}
    </svg>
  );
}

/** StatusMark plus "unknown" (a dotted ring), for raw graph statuses. */
export function Mark({ status, size = 12 }: { status: Status; size?: number }) {
  if (status !== "unknown") return <StatusMark status={status} size={size} />;
  const r = size / 2 - 1;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#5a5a5a" strokeWidth={1} strokeDasharray="1 2" />
    </svg>
  );
}
