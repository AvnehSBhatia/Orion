"use client";

import type { Source } from "@/lib/api/types";
import { sourceLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { openSource } from "@/lib/viewer";
import { Fragment } from "react";

// [1], [S2], [1, 2] and [S1, S3] all count as citations.
const CITE = /\[\s*S?\d+(?:\s*,\s*S?\d+)*\s*\]/g;

/** A reply with its citations turned into small numbered chips; each opens the cited document so every claim can be checked. */
export function ReplyText({
  text,
  sources = [],
  streaming = false,
  className,
}: {
  text: string;
  sources?: Source[];
  /** Still arriving: a caret marks where the next token lands. */
  streaming?: boolean;
  className?: string;
}) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(CITE)) {
    const cited = [...match[0].matchAll(/\d+/g)]
      .map((m) => Number(m[0]))
      .filter((n) => sources[n - 1]);
    parts.push(text.slice(cursor, match.index).replace(/\s+$/, cited.length ? " " : ""));
    for (const n of cited) parts.push(<Cite key={`${match.index}-${n}`} n={n} source={sources[n - 1]} />);
    cursor = match.index + match[0].length;
  }
  parts.push(text.slice(cursor));
  return (
    <p className={cn("whitespace-pre-line", className)}>
      {parts.map((part, index) => (
        <Fragment key={index}>{part}</Fragment>
      ))}
      {streaming && <Caret />}
    </p>
  );
}

function Cite({ n, source }: { n: number; source: Source }) {
  const label = `${source.title || sourceLabel(source)}${source.authorName ? `, ${source.authorName}` : ""}`;
  return (
    <button
      type="button"
      onClick={() => openSource(source.id)}
      title={label}
      aria-label={`Source ${n}: ${label}`}
      className="mx-0.5 inline-flex size-[18px] translate-y-[-2px] items-center justify-center rounded-full border border-line-strong align-middle font-mono text-[10px] text-ink transition-colors hover:border-white hover:bg-white hover:text-black"
    >
      {n}
    </button>
  );
}

/** Where the next token lands while a reply streams in. */
export function Caret() {
  return <span aria-hidden className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-ink" />;
}
