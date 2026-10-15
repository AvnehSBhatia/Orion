"use client";

import { AuditPanel } from "@/components/admin/AuditPanel";
import { CapturePolicyPanel } from "@/components/admin/CapturePolicyPanel";
import { OrgProfilePanel } from "@/components/admin/OrgProfilePanel";
import { PeoplePanel } from "@/components/admin/PeoplePanel";
import { UsagePanel } from "@/components/admin/UsagePanel";
import { useSession } from "@/components/auth/session";
import { PageFrame } from "@/components/settings/PageFrame";
import { Quiet } from "@/components/ui/Quiet";
import { useEffect, useState } from "react";

const TABS = [
  { id: "people", label: "People" },
  { id: "capture", label: "Capture policy" },
  { id: "usage", label: "Usage" },
  { id: "audit", label: "Audit log" },
  { id: "profile", label: "Org profile" },
];

const readHash = () => {
  const id = typeof window === "undefined" ? "" : window.location.hash.slice(1);
  return TABS.some((t) => t.id === id) ? id : "people";
};

export function AdminPage() {
  const { me } = useSession();
  const [tab, setTab] = useState("people");
  // The tab follows the URL hash, so links like /admin#people land on the right one.
  useEffect(() => {
    const sync = () => setTab(readHash());
    const t = window.setTimeout(sync, 0);
    window.addEventListener("hashchange", sync);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("hashchange", sync);
    };
  }, []);
  const choose = (id: string) => {
    window.history.replaceState(null, "", `#${id}`);
    setTab(id);
  };

  if (!me.admin && !me.authDisabled) {
    return (
      <PageFrame title="Admin">
        <Quiet title="Admins only" detail="Ask an admin in your org if you need something changed here." className="py-16" />
      </PageFrame>
    );
  }
  const orgId = me.orgId ?? "";
  return (
    <PageFrame title="Admin" description="People, capture policy, usage, and the audit log for your org." sections={TABS} current={tab} onSection={choose}>
      {tab === "people" && <PeoplePanel self={me.username ?? ""} />}
      {tab === "capture" && <CapturePolicyPanel orgId={orgId} />}
      {tab === "usage" && <UsagePanel orgId={orgId} />}
      {tab === "audit" && <AuditPanel />}
      {tab === "profile" && <OrgProfilePanel orgId={orgId} />}
    </PageFrame>
  );
}
