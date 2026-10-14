// GET /api/health: whether this box can serve. Public, so it says only what an uptime monitor needs.
import fs from "node:fs";
import path from "node:path";
import { config } from "@/config";
import type { EmbedderStatus } from "@/llm/embed";

export type Health = {
  ok: boolean;
  version: string;
  checks: { orgsDir: boolean; authDb: boolean; embedder: EmbedderStatus; llmKey: boolean };
};

export type HealthProbes = {
  /** Runs a trivial query on auth.db; throws when it cannot be opened. */
  authDb: () => void;
  /** The embedder's state; throws when it cannot even be created (for example openrouter without a key). */
  embedder: () => EmbedderStatus;
};

const writable = (dir: string) => {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
};

/** The orgs directory is writable, or does not exist yet and DATA_DIR is (the first org will create it). */
export function orgsDirOk(dataDir = config.dataDir): boolean {
  const dir = path.join(dataDir, "orgs");
  return fs.existsSync(dir) ? writable(dir) : writable(dataDir);
}

export const version = () => process.env.ORION_VERSION || process.env.npm_package_version || "unknown";

/**
 * Fails (ok false, served as 503) when data cannot be written, auth.db cannot be read, the embedder errored, or
 * there is no OpenRouter key. An embedder still loading its model is not a failure.
 */
export function checkHealth(probes: HealthProbes): Health {
  let authDb = true;
  try {
    probes.authDb();
  } catch {
    authDb = false;
  }
  let embedder: EmbedderStatus;
  try {
    embedder = probes.embedder();
  } catch {
    embedder = "error";
  }
  const checks = { orgsDir: orgsDirOk(), authDb, embedder, llmKey: !!config.openRouterKey };
  return { ok: checks.orgsDir && checks.authDb && checks.embedder !== "error" && checks.llmKey, version: version(), checks };
}
