"use client";

import { StatusMark } from "@/components/StatusMark";
import { AnimatedList } from "@/components/ui/animated-list";
import { DOMAIN_LABEL, type Star, statusLabel } from "@/lib/stars";
import { ChevronRight } from "lucide-react";

export function ContextList({
  title,
  description,
  stars,
  onSelect,
}: {
  title: string;
  description: string;
  stars: Star[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="thin-scroll h-full overflow-auto px-4 py-8 md:px-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-[28px] font-semibold tracking-[-0.03em]">{title}</h1>
        <p className="mt-1 text-muted">{description}</p>
        {stars.length === 0 ? (
          <p className="mt-8 text-muted">Nothing is blocked.</p>
        ) : (
          <AnimatedList className="mt-6 flex flex-col divide-y divide-line rounded-2xl border border-line bg-panel">
            {stars.map((star) => (
              <button
                key={star.id}
                type="button"
                onClick={() => onSelect(star.id)}
                className="group flex w-full items-center gap-4 px-4 py-4 text-left transition-colors duration-150 hover:bg-raised md:px-5"
              >
                <StatusMark status={star.status} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-3">
                    <span className="font-medium">{star.label}</span>
                    <span className="font-mono text-[12px] tracking-wide text-faint uppercase">
                      {DOMAIN_LABEL[star.domain]} · {statusLabel(star.status)}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[14px] text-muted">{star.summary}</span>
                </span>
                <span className="hidden shrink-0 text-[13px] text-faint sm:block">{star.updated}</span>
                <ChevronRight className="size-4 shrink-0 text-faint transition-transform duration-150 group-hover:translate-x-0.5" />
              </button>
            ))}
          </AnimatedList>
        )}
      </div>
    </div>
  );
}
