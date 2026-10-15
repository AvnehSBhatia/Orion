import { AdminPage } from "@/components/admin/AdminPage";
import { AuthGate } from "@/components/auth/AuthGate";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Admin · Orion" };

export default function Admin() {
  return (
    <AuthGate>
      <AdminPage />
    </AuthGate>
  );
}
