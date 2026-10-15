"use client";

// The person's saved dashboard: polled, overridden the moment chat or a reset lands one, and announced when it changes.

import { api } from "@/lib/api/client";
import type { DashboardSpec, User } from "@/lib/api/types";
import { fallbackDashboard } from "@/lib/defaults";
import { friendlyError } from "@/lib/errors";
import { usePoll } from "@/lib/usePoll";
import { useRef, useState } from "react";
import type { Toast } from "./useToasts";
import type { Tagged } from "./useWorkspace";

function newer(a: Tagged<DashboardSpec> | null, b: Tagged<DashboardSpec> | null, key: string | null) {
  const live = [a, b].filter((item): item is Tagged<DashboardSpec> => !!item && item.key === key);
  return live.sort((x, y) => Date.parse(y.value.updatedAt) - Date.parse(x.value.updatedAt))[0] ?? null;
}

export function useDashboardSpec({
  orgId,
  userId,
  user,
  notify,
  onChanged,
}: {
  orgId: string | null;
  userId: string | null;
  user: User | null;
  notify: (text: string, kind?: Toast["kind"]) => void;
  /** A different dashboard landed (chat, reset, or another tab). */
  onChanged?: () => void;
}) {
  const [override, setOverride] = useState<Tagged<DashboardSpec> | null>(null);
  const [resetting, setResetting] = useState(false);
  const [reshaping, setReshaping] = useState(false);
  const seen = useRef<{ key: string; at: number } | null>(null);
  const key = orgId && userId ? `${orgId}:${userId}` : null;

  // Announces a dashboard that changed under us: this page's chat, a reset, or one saved from elsewhere.
  const land = (k: string, dashboard: DashboardSpec) => {
    const at = Date.parse(dashboard.updatedAt) || 0;
    const previous = seen.current;
    if (previous && previous.key === k && at <= previous.at) return;
    seen.current = { key: k, at };
    if (!previous || previous.key !== k) return;
    if (dashboard.origin === "chat") notify(`Dashboard: ${dashboard.title}`, "dashboard");
    else notify(`Reset to your role: ${dashboard.title}`, "dashboard");
    onChanged?.();
  };

  const poll = usePoll<Tagged<DashboardSpec>>(
    key,
    async () => {
      const k = key!;
      const { dashboard } = await api.dashboard.get(orgId!, userId!);
      land(k, dashboard);
      return { key: k, value: dashboard };
    },
    3000,
  );
  // A dashboard from chat or reset lands before the next poll; keep whichever is newest so a slow poll cannot undo it.
  const saved = newer(poll.data, override, key);
  const spec = saved?.value ?? fallbackDashboard(user);

  const reset = async () => {
    if (!orgId || !userId || resetting) return;
    setResetting(true);
    try {
      const { dashboard } = await api.dashboard.reset(orgId, userId);
      land(`${orgId}:${userId}`, dashboard);
      setOverride({ key: `${orgId}:${userId}`, value: dashboard });
    } catch {
      notify("Couldn't reset the dashboard. Try again in a moment.");
    } finally {
      setResetting(false);
    }
  };

  /** Sends a layout request; the server's instant draft lands first (no model), the refined spec swaps in after. */
  const reshape = (text: string) => {
    if (!orgId || !userId) return;
    const k = `${orgId}:${userId}`;
    setReshaping(true);
    let drafted = false;
    api.dashboard
      .ask(orgId, userId, text, (draft) => {
        drafted = true;
        land(k, draft);
        setOverride({ key: k, value: draft });
      })
      .then(({ dashboard }) => {
        if (!dashboard) return;
        if (drafted) seen.current = { key: k, at: Date.parse(dashboard.updatedAt) || Date.now() };
        else land(k, dashboard);
        setOverride({ key: k, value: dashboard });
      })
      .catch((error) => notify(friendlyError(error, "change this dashboard")))
      .finally(() => setReshaping(false));
  };

  return { key, spec, saved: saved?.value ?? null, reset, resetting, reshape, reshaping };
}
