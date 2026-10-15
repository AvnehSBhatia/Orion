import { ResetForm } from "@/components/auth/ResetForm";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Reset your password · Orion", robots: { index: false } };

export default async function ResetPage({ params }: PageProps<"/reset/[token]">) {
  const { token } = await params;
  return <ResetForm token={token} />;
}
