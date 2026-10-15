import { getStore } from "@/http/deps";
import { preflight } from "@/http/route";
import { clientsFor } from "@/mac/clients";
import { v1Route } from "@/mac/http";

export const runtime = "nodejs";

/** The firm's clients and alias rules for on-device matching; `since` is the last etag. */
export const GET = v1Route(async (req, _ctx, p) => clientsFor(getStore(p.orgId), p.userId, req.nextUrl.searchParams.get("since")));

export const OPTIONS = preflight;
