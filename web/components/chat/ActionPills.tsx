"use client";

import type { ChatAction } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { openNode, openSource } from "@/lib/viewer";
import { ArrowUpRight, LayoutGrid, MessageCircle } from "lucide-react";

const ACTION_ICON = { open: ArrowUpRight, ask: MessageCircle, show: LayoutGrid } as const;

/**
 * The reply's suggested next steps as small pills: open shows the document or node, ask sends the follow-up,
 * show sends a dashboard request (the send flow reshapes the dashboard for layout words like "show").
 */
export function ActionPills({
  actions = [],
  onSend,
  className,
}: {
  actions?: ChatAction[];
  onSend: (message: string) => void;
  className?: string;
}) {
  if (!actions.length) return null;
  const run = (action: ChatAction) => {
    if (action.kind === "open") return action.target === "node" ? openNode(action.value) : openSource(action.value);
    if (action.kind === "show") return onSend(/^show\b/i.test(action.value) ? action.value : `Show ${action.value}`);
    onSend(action.value);
  };
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {actions.map((action) => {
        const Icon = ACTION_ICON[action.kind];
        return (
          <button
            key={`${action.kind}:${action.value}`}
            type="button"
            onClick={() => run(action)}
            title={action.kind === "open" ? undefined : action.value}
            className="flex items-center gap-1 rounded-full border border-line-strong px-2.5 py-0.5 text-[12px] text-muted transition-colors duration-150 hover:border-[#4a4a4a] hover:text-ink"
          >
            <Icon className="size-3" strokeWidth={1.75} />
            {action.label}
          </button>
        );
      })}
    </div>
  );
}
