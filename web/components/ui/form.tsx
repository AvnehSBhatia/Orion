// Form primitives shared by sign-in, invite, reset, settings, and admin. Every control shows a visible focus ring.

import { cn } from "@/lib/utils";
import type { ComponentProps, ReactNode } from "react";

export const field =
  "mt-1.5 h-11 w-full rounded-md border border-line-strong bg-panel px-3 text-base text-ink outline-none transition-colors placeholder:text-faint focus-visible:border-ink focus-visible:ring-2 focus-visible:ring-ink/40 aria-[invalid=true]:border-danger";

export function FieldError({ id, message }: { id: string; message?: string | null }) {
  // One live region that is always present, so screen readers announce a new error once.
  return (
    <p id={id} role="alert" className={cn("text-sm text-danger", !message && "sr-only")}>
      {message || ""}
    </p>
  );
}

export function PrimaryButton({ className, ...props }: ComponentProps<"button">) {
  return <button {...props} className={cn("h-11 rounded-md bg-ink px-4 text-sm font-medium text-bg disabled:opacity-60", className)} />;
}

export function SecondaryButton({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      {...props}
      className={cn("h-9 rounded-md border border-line-strong px-3 text-[13px] whitespace-nowrap text-ink transition-colors hover:bg-raised disabled:opacity-50", className)}
    />
  );
}

export function Panel({ title, description, children, id, actions }: { title: string; description?: ReactNode; children: ReactNode; id?: string; actions?: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 rounded-2xl border border-line bg-panel p-5 md:p-6" aria-labelledby={id ? `${id}-title` : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={id ? `${id}-title` : undefined} className="text-[16px] font-medium">
            {title}
          </h2>
          {description && <p className="mt-1 max-w-2xl text-[14px] text-muted">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** A small status line for save results: "Saved." or an error. */
export function Notice({ kind, children }: { kind: "ok" | "error"; children: ReactNode }) {
  return (
    <p role={kind === "error" ? "alert" : "status"} className={cn("text-[13px]", kind === "error" ? "text-danger" : "text-muted")}>
      {children}
    </p>
  );
}
