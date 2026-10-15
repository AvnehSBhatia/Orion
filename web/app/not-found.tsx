import { Centered } from "@/components/auth/Centered";
import { Logo } from "@/components/ui/Logo";
import Link from "next/link";

export default function NotFound() {
  return (
    <Centered>
      <Logo size={24} />
      <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.02em]">This page doesn&apos;t exist</h1>
      <p className="mt-2 text-sm text-muted">The link may be old or mistyped.</p>
      <Link href="/" className="mt-5 inline-block rounded-md border border-line-strong px-4 py-2 text-sm text-ink hover:bg-raised">
        Go to your dashboard
      </Link>
    </Centered>
  );
}
