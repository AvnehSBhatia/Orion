import { AuthGate } from "@/components/auth/AuthGate";
import { SettingsPage } from "@/components/settings/SettingsPage";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Settings · Orion" };

export default function Settings() {
  return (
    <AuthGate>
      <SettingsPage />
    </AuthGate>
  );
}
