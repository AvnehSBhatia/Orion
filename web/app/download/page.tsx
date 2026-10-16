import { MacDownload } from "@/components/download/MacDownload";
import { Logo } from "@/components/ui/Logo";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Download for Mac · Orion",
  description: "Install Orion for Mac, the app that sends the work you approve to your team's Orion.",
};

/** Public: no sign-in, so a new teammate can install the app before their first visit. */
export default function DownloadPage() {
  return (
    <div className="min-h-dvh bg-bg text-ink">
      <header className="flex h-14 items-center gap-3 border-b border-line px-4 md:px-6">
        <Link href="/" className="flex items-center gap-2.5 rounded-md text-[14px] font-semibold">
          <Logo />
          Orion
        </Link>
      </header>
      <main id="main" className="mx-auto w-full max-w-2xl px-4 py-8 text-[15px] text-muted md:px-8 md:py-12">
        <MacDownload />
      </main>
    </div>
  );
}
