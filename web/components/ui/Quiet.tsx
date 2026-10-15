import { cn } from "@/lib/utils";

/** Empty states should read as a calm instrument at rest, not an error. */
export function Quiet({ title, detail, className }: { title: string; detail?: string; className?: string }) {
  return (
    <div className={cn("flex h-full min-h-[96px] flex-col items-center justify-center gap-1.5 px-6 py-6 text-center", className)}>
      <svg width={28} height={28} viewBox="0 0 28 28" aria-hidden className="mb-1 opacity-70">
        <circle cx={14} cy={14} r={12.5} fill="none" stroke="#2e2e2e" strokeDasharray="1.2 3.6" />
        <circle cx={14} cy={14} r={2.2} fill="#5a5a5a" />
        <circle cx={22.5} cy={7} r={1.2} fill="#8f8f8f" />
      </svg>
      <p className="text-[14px] text-muted">{title}</p>
      {detail && <p className="max-w-[34ch] text-[13px] text-faint">{detail}</p>}
    </div>
  );
}
