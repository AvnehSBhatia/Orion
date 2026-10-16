import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installScript, latestMac, macZip, publicOrigin } from "./mac";

let dir: string;
const release = { version: "0.7.0", file: "Constellation-0.7.0.zip", sha256: "a".repeat(64), size: 3, publishedAt: "2026-10-16T00:00:00Z", minMacos: "14.0" };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "orion-downloads-"));
  fs.mkdirSync(path.join(dir, "mac"));
  process.env.DOWNLOADS_DIR = dir;
});
afterEach(() => {
  delete process.env.DOWNLOADS_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("Mac downloads", () => {
  it("has no release until latest.json is published, and ignores a malformed one", async () => {
    expect(await latestMac()).toBeNull();
    fs.writeFileSync(path.join(dir, "mac/latest.json"), JSON.stringify({ ...release, file: "../../etc/passwd" }));
    expect(await latestMac()).toBeNull();
    fs.writeFileSync(path.join(dir, "mac/latest.json"), JSON.stringify(release));
    expect(await latestMac()).toEqual(release);
  });

  it("serves only release zips from the folder", async () => {
    fs.writeFileSync(path.join(dir, "mac/Constellation-0.7.0.zip"), "zip");
    fs.writeFileSync(path.join(dir, "mac/secret.txt"), "no");
    const res = await macZip("Constellation-0.7.0.zip");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="Constellation-0.7.0.zip"');
    expect(await res.text()).toBe("zip");
    await expect(macZip("secret.txt")).rejects.toMatchObject({ status: 404 });
    await expect(macZip("Constellation-../x.zip")).rejects.toMatchObject({ status: 404 });
    await expect(macZip("Constellation-0.8.0.zip")).rejects.toMatchObject({ status: 404 });
  });

  it("writes an install script for the API's own address that is valid bash", () => {
    const origin = publicOrigin(new Request("http://localhost:3001/api/downloads/mac/install.sh"));
    expect(origin).toBe("http://localhost:3001");
    const script = installScript(origin);
    expect(script).toContain('API="http://localhost:3001"');
    expect(script).toContain("shasum -a 256");
    const file = path.join(dir, "install.sh");
    fs.writeFileSync(file, script);
    expect(() => execFileSync("bash", ["-n", file])).not.toThrow();
  });
});
