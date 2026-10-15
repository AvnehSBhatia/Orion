import { Logo } from "@/components/ui/Logo";
import { Markdown } from "@/lib/markdown";
import type { Metadata } from "next";
import Link from "next/link";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const metadata: Metadata = { title: "Privacy · Orion", description: "What Orion collects, why, who sees it, and how long it is kept." };

/** The policy is maintained in the repo at docs/legal/privacy-policy.md; the page renders it at build time. */
async function readPolicy(): Promise<string | null> {
  const candidates = [
    process.env.ORION_PRIVACY_POLICY_PATH,
    path.join(process.cwd(), "..", "docs", "legal", "privacy-policy.md"),
    path.join(process.cwd(), "docs", "legal", "privacy-policy.md"),
  ].filter((p): p is string => !!p);
  for (const file of candidates) {
    try {
      return await readFile(file, "utf8");
    } catch {
      // Try the next location.
    }
  }
  return null;
}

export default async function PrivacyPage() {
  const policy = await readPolicy();
  const draft = !!policy && /\bDRAFT\b/.test(policy.slice(0, 600));
  // The draft marker is shown as a banner instead of as the policy's first paragraph.
  const body = policy?.replace(/^>\s*\*\*DRAFT[^\n]*\n+/, "") ?? null;
  return (
    <div className="min-h-dvh bg-bg text-ink">
      <header className="flex h-14 items-center gap-3 border-b border-line px-4 md:px-6">
        <Link href="/" className="flex items-center gap-2.5 rounded-md text-[14px] font-semibold">
          <Logo />
          Orion
        </Link>
      </header>
      <main id="main" className="mx-auto w-full max-w-3xl px-4 py-8 text-[15px] text-muted md:px-8 md:py-12">
        {draft && (
          <p role="note" className="mb-6 rounded-lg border border-line-strong bg-panel px-4 py-3 text-[14px] text-ink">
            <strong className="font-semibold">Draft.</strong> This policy is being reviewed by counsel and is not yet in effect. Bracketed text is still to be
            confirmed.
          </p>
        )}
        {body ? (
          <Markdown source={body} />
        ) : (
          <>
            <h1 className="text-[28px] font-semibold tracking-[-0.03em] text-ink">Privacy</h1>
            <p className="mt-4 leading-relaxed">
              Orion records only the browser tabs, windows, and screens a person chooses to share, while recording is on. Your employer controls
              how Orion is used and who can see what. The full privacy policy isn&apos;t published on this server yet; ask your Orion admin for a
              copy, or to see, correct, or delete your data.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
