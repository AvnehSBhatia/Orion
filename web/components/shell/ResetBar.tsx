"use client";

import { cn } from "@/lib/utils";
import { RotateCcw } from "lucide-react";

/** The way back from a chat-built dashboard to the one composed from the person's role. */
export function ResetBar({ resetting, onReset }: { resetting: boolean; onReset: () => void }) {
  return (
    <div className="mx-auto -mb-4 flex w-full max-w-[1400px] justify-end px-4 pt-5 md:-mb-6 md:px-8">
      <button
        type="button"
        onClick={onReset}
        disabled={resetting}
        className="flex items-center gap-1.5 rounded-full border border-line-strong px-3 py-1 text-[13px] text-muted transition-colors hover:border-[#4a4a4a] hover:text-ink disabled:opacity-50"
      >
        <RotateCcw className={cn("size-3.5", resetting && "animate-spin [animation-direction:reverse]")} />
        Reset to my role
      </button>
    </div>
  );
}
