import { InviteForm } from "@/components/auth/InviteForm";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Join Orion", robots: { index: false } };

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  return <InviteForm token={token} />;
}
