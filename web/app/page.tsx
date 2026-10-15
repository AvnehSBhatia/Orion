import { AuthGate } from "@/components/auth/AuthGate";
import { AppShell } from "@/components/shell/AppShell";

export default function Home() {
  return (
    <AuthGate>
      <AppShell />
    </AuthGate>
  );
}
