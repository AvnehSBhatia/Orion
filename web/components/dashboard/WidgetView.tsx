"use client";

import { applyFilter, hasFilter, sourceMatches } from "@/components/dashboard/filters";
import { WidgetCard } from "@/components/dashboard/WidgetCard";
import { Quiet } from "@/components/ui/Quiet";
import type { ActivityResponse, GraphResponse, PublicNode, Widget } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { memo, useContext, useMemo } from "react";
import { ActivityFeed } from "./ActivityFeed";
import type { Card } from "./cardBank";
import { ChangeCard, ClusterCard, NodeCard, PersonCard } from "./cards";
import { Constellation } from "./constellation/Constellation";
import { LiveDot, StaleContext } from "./DashboardHeader";
import { DomainBreakdown, Gaps, Kpi, METRIC_LABEL, NodeList, Note, People, StatusBreakdown } from "./widgets";

export const CardView = memo(function CardView({
  card: c,
  graph,
  activity,
  orgId,
  highlightIds,
  on,
  onSelectNode,
  renderMap,
  nodeById,
  now,
}: {
  card: Card;
  graph: GraphResponse | null;
  activity: ActivityResponse | null;
  orgId: string;
  highlightIds: string[];
  on: boolean;
  onSelectNode: (id: string) => void;
  renderMap?: () => React.ReactNode;
  nodeById: Map<string, PublicNode>;
  now: number;
}) {
  switch (c.kind) {
    case "node":
      return <NodeCard node={c.node} now={now} on={on} wide={c.size !== "sm"} onSelect={onSelectNode} />;
    case "person":
      return <PersonCard name={c.name} count={c.count} lastAt={c.lastAt} latest={c.latest} now={now} />;
    case "cluster":
      return <ClusterCard label={c.label} count={c.count} top={c.top} onSelect={onSelectNode} />;
    case "change":
      return <ChangeCard source={c.source} change={c.change} now={now} />;
    case "widget":
      return (
        <WidgetView
          widget={c.widget}
          size={c.size}
          graph={graph}
          activity={activity}
          orgId={orgId}
          highlightIds={highlightIds}
          onSelectNode={onSelectNode}
          renderMap={renderMap}
          nodeById={nodeById}
        />
      );
  }
});

function WidgetView({
  widget: w,
  size,
  graph,
  activity,
  orgId,
  highlightIds,
  onSelectNode,
  renderMap,
  nodeById,
}: {
  widget: Widget;
  size: Widget["size"];
  graph: GraphResponse | null;
  activity: ActivityResponse | null;
  orgId: string;
  highlightIds: string[];
  onSelectNode: (id: string) => void;
  renderMap?: () => React.ReactNode;
  nodeById: Map<string, PublicNode>;
}) {
  const stale = useContext(StaleContext);
  const filtered = hasFilter(w.filter);
  const nodes = useMemo(() => applyFilter(graph?.nodes ?? [], w.filter), [graph, w.filter]);
  const big = size === "lg" || size === "full";
  const loadingGraph = <Quiet title="Loading" />;

  switch (w.kind) {
    case "kpi":
      return <Kpi widget={w} nodes={nodes} graph={graph} activity={activity} filtered={filtered} />;

    case "status_breakdown":
      return (
        <WidgetCard title={w.title || "By status"} note={graph ? nodes.length : undefined}>
          {graph ? <StatusBreakdown nodes={nodes} /> : loadingGraph}
        </WidgetCard>
      );

    case "domain_breakdown":
      return (
        <WidgetCard title={w.title || "By domain"} note={graph ? nodes.length : undefined}>
          {graph ? <DomainBreakdown nodes={nodes} /> : loadingGraph}
        </WidgetCard>
      );

    case "node_list":
      return (
        <WidgetCard title={w.title || "Projects"} note={graph ? `${nodes.length}` : undefined} flush>
          {graph ? <NodeList nodes={nodes} highlightIds={highlightIds} onSelectNode={onSelectNode} tall={big} /> : loadingGraph}
        </WidgetCard>
      );

    case "activity": {
      const all = activity?.sources ?? [];
      const ids = new Set(nodes.map((n) => n.id));
      // A card about commits or pull requests shows code changes only, newest first.
      const codeOnly = /commit|code|pull request|\bprs?\b|git|merge/i.test(`${w.title} ${w.filter?.query ?? ""}`);
      const sources = codeOnly
        ? all.filter((s) => s.kind === "code")
        : filtered
          ? all.filter((s) => sourceMatches(s, ids, w.filter))
          : all;
      return (
        <WidgetCard title={w.title || "Activity"} note={<LiveDot on={!!activity && !stale} label={activity ? `${activity.counts.lastHour}/hr` : "…"} />} flush>
          <div className={cn("thin-scroll overflow-auto", big ? "max-h-[460px]" : "max-h-[300px]")}>
            <ActivityFeed
              sources={sources}
              orgId={orgId}
              limit={big ? 16 : 6}
              loading={!activity}
              highlightIds={highlightIds}
              onSelectNode={onSelectNode}
            />
          </div>
        </WidgetCard>
      );
    }

    case "constellation":
      return (
        <div className={cn("overflow-hidden rounded-2xl border border-line", big ? "h-[420px]" : size === "md" ? "h-[320px]" : "h-[260px]")}>
          <Constellation key={orgId} orgId={orgId} highlightIds={highlightIds} onSelect={onSelectNode} graph={graph} />
        </div>
      );

    case "map":
      return (
        <div className={cn("relative overflow-hidden rounded-2xl border border-line bg-bg", big ? "h-[440px]" : "h-[340px]")}>
          {renderMap?.()}
        </div>
      );

    case "gaps": {
      const gaps = (graph?.gaps ?? []).filter((g) => !filtered || nodes.some((n) => n.id === g.nodeId));
      return (
        <WidgetCard title={w.title || "Gaps"} note={graph ? `${gaps.length}` : undefined} flush>
          {graph ? <Gaps gaps={gaps} nodes={nodeById} onSelectNode={onSelectNode} /> : loadingGraph}
        </WidgetCard>
      );
    }

    case "people":
      return (
        <WidgetCard title={w.title || "People"} note={activity ? activity.counts.people : undefined}>
          {activity ? <People people={activity.people} /> : <Quiet title="Listening" />}
        </WidgetCard>
      );

    case "note":
      return (
        <WidgetCard title={w.title || "Note"}>
          <Note text={w.text} />
        </WidgetCard>
      );

    default:
      return (
        <WidgetCard title={w.title || METRIC_LABEL.total_nodes}>
          <Quiet title="Unsupported" />
        </WidgetCard>
      );
  }
}
