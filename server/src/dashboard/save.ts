import type { DashboardSpec, User } from "@/contract/types";
import type { Store } from "@/db/store";
import { HttpError } from "@/http/error";
import { resolveDashboard, type ComposeDeps } from "./compose";
import { sanitizeDashboard } from "./widgets";

/** Saves an edited dashboard (widgets checked against the graph), or with `reset`, recomposes it from the role. */
export async function saveOrResetDashboard(
  store: Store,
  user: User,
  body: { dashboard?: { origin: DashboardSpec["origin"] }; reset?: boolean },
  deps: ComposeDeps,
): Promise<DashboardSpec> {
  if (body.reset) {
    store.deleteDashboard(user.id);
    return resolveDashboard(store, user, deps);
  }
  const known = new Set(store.listNodes().map((n) => n.id));
  const dashboard = sanitizeDashboard(body.dashboard, { origin: body.dashboard!.origin, allowedIds: known });
  if (!dashboard) throw new HttpError(400, "dashboard needs at least one valid widget");
  store.saveDashboard(user.id, dashboard);
  return dashboard;
}
