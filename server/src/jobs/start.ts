// Process startup for the Node server (called from instrumentation.ts): background jobs and the embedder warm-up.
import { getAuthDb } from "@/auth/db";
import { config } from "@/config";
import { checkHealth } from "@/health";
import { getEmbedder, getLlm, getStore } from "@/http/deps";
import { maintainInBackground } from "@/orgspace/maintain";
import { logJson, safely } from "./log";
import { orgIdsOnDisk, startScheduler } from "./scheduler";

export function startBackgroundJobs(): void {
  // Logged, never fatal: a stray rejection in background work must not take the API down.
  if (!process.listenerCount("unhandledRejection")) {
    process.on("unhandledRejection", (reason) => logJson("error", "unhandled rejection", { err: reason }));
  }

  if (process.env.BACKGROUND_JOBS !== "off") {
    startScheduler({
      orgIds: () => orgIdsOnDisk(config.dataDir),
      store: (orgId) => getStore(orgId),
      maintain: (store) => maintainInBackground(store, getEmbedder(), getLlm(), config.extractModel),
      authDb: getAuthDb,
      healthy: () => {
        const h = checkHealth({
          authDb: () => void getAuthDb().db.prepare("SELECT 1").get(),
          embedder: () => getEmbedder().status?.() ?? "ready",
        });
        return { ok: h.ok, failing: Object.entries(h.checks).filter(([, v]) => v === false || v === "error").map(([k]) => k) };
      },
    });
  }

  // Load the local embedding model now rather than on the first request (about 30s and 1 to 2GB of memory).
  if (process.env.EMBED_WARM !== "false") {
    const embedder = getEmbedder() as { warm?: () => Promise<unknown> };
    if (embedder.warm) void safely("embedder warm-up", () => embedder.warm!());
  }
}
