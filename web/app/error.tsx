"use client";

import { Centered } from "@/components/auth/Centered";
import { Logo } from "@/components/ui/Logo";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Centered>
      <Logo size={24} />
      <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.02em]">Something broke on this page</h1>
      <p className="mt-2 text-sm text-muted">Your data is safe. Reload the page, and if it keeps happening, tell your admin.</p>
      <button type="button" onClick={reset} className="mt-5 rounded-md border border-line-strong px-4 py-2 text-sm text-ink hover:bg-raised">
        Try again
      </button>
    </Centered>
  );
}
