import { getAuthDb } from "@/auth/db";
import { getStore } from "@/http/deps";
import { preflight } from "@/http/route";
import { v1Route } from "@/mac/http";
import { deleteMacData } from "@/mac/mydata";

export const runtime = "nodejs";

/** The person's work blocks, drafts, entries, baseline and the documents made from their blocks, removed now. */
export const DELETE = v1Route(async (_req, _ctx, p) => Response.json(deleteMacData(getAuthDb(), getStore(p.orgId), p), { status: 202 }));

export const OPTIONS = preflight;
