import { AuthGate } from "@/components/auth/AuthGate";
import { SharingPage } from "@/components/settings/SharingPage";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "What others can see · Orion" };

export default function Sharing() {
  return (
    <AuthGate>
      <SharingPage />
    </AuthGate>
  );
}
