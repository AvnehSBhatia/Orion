"use client";

// Context: how the work connects. Dependency chains, topic clusters, and who feeds what.
// Polls its own data for `orgId`; the other props set the title and, for scoped views, which nodes to keep.

import type { Star } from "@/lib/stars";
import { cn } from "@/lib/utils";
import { Chains } from "@/components/context/Chains";
import { Clusters } from "@/components/context/Clusters";
import { Lanes } from "@/components/context/Lanes";
import { useContextData } from "@/components/context/useContextData";
import { useMemo } from "react";

export function ContextList({
  orgId,
  title,
  description,
  stars,
}: {
  orgId: string | null;
  title: string;
  description: string;
  stars: Star[];
}) {
  const { graph, activity, embeddings, offline } = useContextData(orgId);
  const scoped = title !== "Context";
  const ids = useMemo(() => stars.map((s) => s.id).join("|"), [stars]);
  const scope = useMemo(() => (scoped ? new Set(ids ? ids.split("|") : []) : null), [scoped, ids]);

  return (
    // Locked frame: the header stays put and the sections scroll inside a bounded panel that ends above the chat dock.
    <div className="flex h-full flex-col px-4 pt-8 pb-4 md:px-8">
      <header className="mx-auto w-full max-w-[1400px] shrink-0 pb-4">
        <h1 className="text-[28px] font-semibold tracking-[-0.03em]">{title}</h1>
        <p className="mt-1 text-muted">{scoped ? description : "How the work connects."}</p>
        {offline && <p className="mt-2 text-[13px] text-faint">Orion is offline. Showing the last data received.</p>}
      </header>
      {/* One frame: dependencies on the left, lanes and topics stacked on the right. Each panel scrolls on its own. */}
      <div className="thin-scroll mx-auto grid min-h-0 w-full max-w-[1400px] flex-1 gap-4 overflow-auto lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:grid-rows-[minmax(260px,1.3fr)_minmax(220px,1fr)]">
        <Panel className="lg:row-span-2">
          <Chains graph={graph} scope={scope} />
        </Panel>
        <Panel>
          <Lanes activity={activity} scope={scope} />
        </Panel>
        <Panel>
          <Clusters embeddings={embeddings} scope={scope} />
        </Panel>
      </div>
    </div>
  );
}

function Panel({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <section
      className={cn(
        "thin-scroll min-h-0 overflow-auto overscroll-contain rounded-2xl border border-line bg-panel/40 p-4 max-lg:max-h-[70vh]",
        className,
      )}
    >
      {children}
    </section>
  );
}
