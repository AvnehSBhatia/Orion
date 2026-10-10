import type { NextRequest } from "next/server";
import { chatRequest } from "@/contract/schemas";
import type { ChatResponse } from "@/contract/types";
import { toPublicUser } from "@/db/store";
import { getChat, getEmbedder, getStore, requireUser } from "@/server/deps";
import { preflight, route } from "@/server/http";
import { buildContext, findNodes, findSources } from "@/steer/context";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = route(async (req: NextRequest): Promise<ChatResponse> => {
  const body = chatRequest.parse(await req.json());
  const store = getStore(body.orgId);
  const embedder = getEmbedder();
  const user = requireUser(store, body.userId);
  const context = await buildContext(store, embedder, { userId: user.id, q: body.message });

  return getChat().reply({
    user: toPublicUser(user),
    org: store.getOrg(),
    message: body.message,
    context,
    currentView: body.currentView,
    knownIds: new Set(store.listNodes().map((n) => n.id)),
    find: ({ q, filter, limit }) => findNodes(store, embedder, { userId: user.id, q, k: limit, filter }),
    findSources: ({ q, sinceHours, limit }) => findSources(store, embedder, { userId: user.id, q, k: limit, sinceHours }),
    readSource: (id) => store.readDocument(id),
  });
});

export const OPTIONS = preflight;
