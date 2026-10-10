import type { Status } from "@/lib/stars";

export function StatusMark({ status, size = 12 }: { status: Status; size?: number }) {
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
