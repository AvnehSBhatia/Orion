import { cn } from "@/lib/utils";

export function WidgetCard({
  title,
  note,
  className,
  flush,
  children,
}: {
  title: string;
  note?: React.ReactNode;
  className?: string;
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("flex h-full min-h-0 flex-col rounded-2xl border border-line bg-panel", className)}>
      <div className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-3">
        <h2 className="truncate text-[14px] font-medium">{title}</h2>
        {note && <span className="shrink-0 font-mono text-[11px] tracking-wide text-faint uppercase">{note}</span>}
      </div>
      <div className={cn("min-h-0 flex-1", !flush && "px-5 pb-5")}>{children}</div>
    </section>
  );
}
