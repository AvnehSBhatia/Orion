"use client";

// Topic clusters: each named region of the embedding space, who feeds it, and what landed there last.

import { Quiet } from "@/components/ui/Quiet";
import type { Domain, EmbeddingPoint, EmbeddingsResponse } from "@/lib/api/types";
import { DOMAIN_TINT } from "@/lib/domain";
import { initials } from "@/lib/format";
import { agoShort, useNow } from "@/lib/time";
import { useMemo } from "react";
import { SectionHead, Shell } from "./Section";
import { openNode, openSource } from "@/lib/viewer";

type Card = {
  id: string;
  label: string;
  size: number;
  people: { name: string; n: number }[];
  newest: EmbeddingPoint[];
  domain: Domain | null;
};

export function Clusters({ embeddings, scope }: { embeddings: EmbeddingsResponse | null; scope: Set<string> | null }) {
  const now = useNow(15000);
  const cards = useMemo<Card[]>(() => {
    if (!embeddings) return [];
    const byCluster = new Map<string, EmbeddingPoint[]>();
    for (const p of embeddings.points) {
      if (!p.clusterId) continue;
      (byCluster.get(p.clusterId) ?? byCluster.set(p.clusterId, []).get(p.clusterId)!).push(p);
    }
    return embeddings.clusters
      .map((c) => {
        const pts = byCluster.get(c.id) ?? [];
        const authors = new Map<string, number>();
        const domains = new Map<Domain, number>();
        for (const p of pts) {
          if (p.author) authors.set(p.author, (authors.get(p.author) ?? 0) + 1);
          if (p.domain) domains.set(p.domain, (domains.get(p.domain) ?? 0) + 1);
        }
        return {
          id: c.id,
          label: c.label,
          size: c.size || pts.length,
          people: [...authors].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, n]) => ({ name, n })),
          newest: [...pts].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 3),
          domain: [...domains].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
          pts,
        };
      })
      .filter((c) => !scope || c.pts.some((p) => scope.has(p.id)))
      .sort((a, b) => b.size - a.size);
  }, [embeddings, scope]);

  return (
    <section>
      <SectionHead title="Topics" note={cards.length ? `${cards.length} areas` : undefined} />
      {cards.length === 0 ? (
        <Shell><Quiet title={embeddings ? "No topics yet." : "Loading topics…"} detail={embeddings ? "Topics form once there are enough captures to group." : undefined} /></Shell>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {cards.map((c) => (
            <article key={c.id} className="flex flex-col rounded-2xl border border-line bg-panel p-4">
              <header className="flex items-baseline gap-2">
                {c.domain && <span className="size-2 shrink-0 translate-y-[-1px] rounded-full" style={{ backgroundColor: DOMAIN_TINT[c.domain] }} />}
                <h3 className="min-w-0 flex-1 truncate text-[15px] font-medium">{c.label}</h3>
                <span className="font-mono text-[12px] text-faint tabular-nums">{c.size}</span>
              </header>
              {c.people.length > 0 && (
                <div className="mt-2.5 flex items-center gap-1.5">
                  {c.people.map((p) => (
                    <span key={p.name} title={`${p.name} · ${p.n}`} className="flex items-center gap-1.5 rounded-full border border-line-strong py-0.5 pr-2 pl-0.5 text-[12px] text-muted">
                      <span className="grid size-5 place-items-center rounded-full bg-raised font-mono text-[10px] text-ink">{initials(p.name)}</span>
                      <span className="max-w-[10ch] truncate">{p.name.split(/\s+/)[0]}</span>
                    </span>
                  ))}
                </div>
              )}
              <ul className="mt-3 space-y-0.5 border-t border-line pt-2">
                {c.newest.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => (p.kind === "node" ? openNode(p.id) : openSource(p.id))}
                      className="-mx-1.5 flex w-[calc(100%+0.75rem)] items-baseline gap-2 rounded-md px-1.5 py-1 text-left text-[13px] transition-colors duration-150 hover:bg-raised"
                    >
                      <span className="w-9 shrink-0 font-mono text-[10px] tracking-wide text-faint uppercase">{p.kind === "node" ? "node" : "cap"}</span>
                      <span className="min-w-0 flex-1 truncate text-muted">{p.label}</span>
                      <span className="shrink-0 font-mono text-[11px] text-faint">{agoShort(p.createdAt, now)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
