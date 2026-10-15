import type { ReactNode } from "react";

/** A narrow centered column for sign-in, invite, reset, and error screens. */
export function Centered({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10 text-ink">
      <div className={wide ? "w-full max-w-xl" : "w-full max-w-sm"}>{children}</div>
    </main>
  );
}
