import fs from "node:fs";
import path from "node:path";
import { config } from "@/config";
import { DEFAULT_ORG } from "@/contract/schemas";
import type { Org, OrgSummary } from "@/contract/types";
import { DEMO_ORG, seedDemo } from "@/db/seed";
import { Store } from "@/db/store";
import type { IngestDeps } from "@/ingest/pipeline";
import { LlmChat, type ChatModel } from "@/llm/chat";
import { createEmbedder, type Embedder } from "@/llm/embed";
import { LlmExtractor, type Extractor } from "@/llm/extract";
import { OpenRouterClient, type LlmClient } from "@/llm/openrouter";
import { HttpError } from "./error";

type Singletons = { stores: Map<string, Store>; embedder?: Embedder; extractor?: Extractor; chat?: ChatModel; llm?: LlmClient };

// Survives Next dev hot reloads so we keep one SQLite handle per org per process.
const g = globalThis as typeof globalThis & { __orion?: Singletons };
const cache: Singletons = (g.__orion ??= { stores: new Map() });

export function orgDbPath(orgId: string): string {
  return path.join(config.dataDir, "orgs", `${orgId}.db`);
}

/** The file is the truth: an org whose .db was deleted is gone, even if a handle to it is still cached. */
export const orgExists = (orgId: string) => orgId === DEFAULT_ORG || fs.existsSync(orgDbPath(orgId));

function openStore(orgId: string): Store {
  let store = cache.stores.get(orgId);
  // The file was deleted under us (a fresh demo start): drop the stale handle and open a new file.
  if (store && orgId !== DEFAULT_ORG && !fs.existsSync(orgDbPath(orgId))) {
    try {
      (store as { db: { close(): void } }).db.close();
    } catch {}
    cache.stores.delete(orgId);
    store = undefined;
  }
  // After a dev hot reload a cached handle is an instance of the old Store class and lacks new methods.
  if (store && !(store instanceof Store)) {
    (store as { db: { close(): void } }).db.close();
    store = undefined;
  }
  if (!store) {
    store = Store.open(orgDbPath(orgId));
    if (orgId === DEFAULT_ORG) {
      if (seedDemo(store)) console.log(`Seeded demo org into ${orgDbPath(orgId)}`);
      if (!store.getOrg()) store.saveOrg({ ...DEMO_ORG, createdAt: new Date().toISOString() });
    }
    cache.stores.set(orgId, store);
  }
  return store;
}

/** The org's SQLite file. Orgs are made with `createOrgStore` (POST /api/orgs); the demo org is seeded on first use. */
export function getStore(orgId: string = DEFAULT_ORG): Store {
  if (!orgExists(orgId)) throw new HttpError(404, `unknown orgId "${orgId}". Create it with POST /api/orgs, or GET /api/orgs to list orgs.`);
  return openStore(orgId);
}

export function createOrgStore(org: Org): Store {
  if (orgExists(org.id)) throw new HttpError(409, `org "${org.id}" already exists. Pick another id.`);
  const store = openStore(org.id);
  store.saveOrg(org);
  return store;
}

function summarize(id: string): OrgSummary {
  const store = openStore(id);
  const org = store.getOrg();
  return { id, name: org?.name ?? id, description: org?.description ?? "", members: store.listUsers().length };
}

/** Every org on disk, or with `only`, just that one (a signed-in caller sees only their own org). */
export function listOrgs(only?: string): OrgSummary[] {
  if (only !== undefined) return orgExists(only) ? [summarize(only)] : [];
  const dir = path.join(config.dataDir, "orgs");
  const onDisk = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".db")).map((f) => f.slice(0, -3)) : [];
  return [...new Set([DEFAULT_ORG, ...onDisk])].sort().map(summarize);
}

export function getEmbedder(): Embedder {
  return (cache.embedder ??= createEmbedder());
}

export function getLlm(): LlmClient {
  return (cache.llm ??= new OpenRouterClient());
}

export function getIngestDeps(orgId: string): IngestDeps {
  return {
    store: getStore(orgId),
    embedder: getEmbedder(),
    extractor: (cache.extractor ??= new LlmExtractor(getLlm())),
    background: { llm: getLlm(), model: config.extractModel },
  };
}

export function getChat(): ChatModel {
  return (cache.chat ??= new LlmChat());
}

export function requireUser(store: Store, userId: string) {
  const user = store.getUser(userId);
  if (!user) throw new HttpError(404, `unknown userId "${userId}". GET /api/users lists valid ids for the org.`);
  return user;
}
