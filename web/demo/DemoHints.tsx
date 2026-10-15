"use client";

import { cardHint, sectionHint, useDemo } from "./state";

/** A one-line plain-English label that floats above a dashboard card on hover. */
export function DemoCardHint({ kind, widgetKind }: { kind: string; widgetKind?: string }) {
  const demo = useDemo();
  const text = demo.on ? cardHint(kind, widgetKind) : null;
  if (!text) return null;
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-3 z-30 mb-1.5 w-max max-w-[min(340px,calc(100%-24px))] rounded-lg border border-line-strong bg-black/90 px-2.5 py-1.5 text-[12px] leading-snug text-muted opacity-0 shadow-[0_8px_24px_rgba(0,0,0,0.5)] backdrop-blur-md transition-opacity duration-150 group-hover/card:opacity-100 group-hover/card:delay-300"
    >
      {text}
    </span>
  );
}

/** The plain-English line under a Context section title. */
export function DemoSectionHint({ title }: { title: string }) {
  const demo = useDemo();
  const hint = demo.on ? sectionHint(title) : null;
  if (!hint) return null;
  return <p className="mt-0.5 text-[12.5px] leading-snug text-faint">{hint}</p>;
}
