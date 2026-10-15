import { getAuthDb } from "@/auth/db";
import { getStore } from "@/http/deps";
import { preflight, readJson } from "@/http/route";
import { clientInput, createClient, listClients } from "@/mac/clients";
import { assertOwner, v1Route } from "@/mac/http";

export const runtime = "nodejs";

export const GET = v1Route(async (_req, _ctx, p) => {
  assertOwner(p);
  return { clients: listClients(getStore(p.orgId)) };
});

export const POST = v1Route(async (req, _ctx, p) => {
  assertOwner(p);
  const client = createClient(getAuthDb(), getStore(p.orgId), p, clientInput.parse(await readJson(req)));
  return Response.json(client, { status: 201 });
});

export const OPTIONS = preflight;
