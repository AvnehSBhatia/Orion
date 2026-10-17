import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { agentBundle } from "./agent";

afterEach(() => delete process.env.CODEBASE_AGENT_BUNDLE);

describe("codebase agent download", () => {
  it("serves the built file, and 404s on a server where it was not built", async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "orion-agent-")), "ctx-sync.mjs");
    process.env.CODEBASE_AGENT_BUNDLE = file;
    await expect(agentBundle()).rejects.toMatchObject({ status: 404 });
    fs.writeFileSync(file, "console.log(1)");
    const res = await agentBundle();
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(await res.text()).toBe("console.log(1)");
  });
});
