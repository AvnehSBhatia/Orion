import { cn } from "@/lib/utils";
import { DemoSectionHint } from "orion-demo";

export function SectionHead({ title, note }: { title: string; note?: string }) {
  return (
    <div className="mb-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[14px] font-medium">{title}</h2>
        {note && <span className="font-mono text-[11px] tracking-wide text-faint uppercase">{note}</span>}
      </div>
      <DemoSectionHint title={title} />
    </div>
  );
}

export function Shell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("overflow-hidden rounded-2xl border border-line bg-panel", className)}>{children}</div>;
}
