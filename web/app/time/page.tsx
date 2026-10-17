import { AuthGate } from "@/components/auth/AuthGate";
import { TimesheetPage } from "@/components/time/TimesheetPage";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Timesheet · Orion" };

export default function Time() {
  return (
    <AuthGate>
      <TimesheetPage />
    </AuthGate>
  );
}
