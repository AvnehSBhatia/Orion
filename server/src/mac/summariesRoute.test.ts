import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthDb, setAuthDb } from "@/auth/db";
import { createOrgStore } from "@/http/deps";
import { saveOrgSettings } from "@/orgs/settings";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orion-summaries-"));
let db: AuthDb;
let token: string;

beforeAll(async () => {
  process.env.DATA_DIR = dir;
  delete process.env.OPENROUTER_API_KEY;
  db = AuthDb.open(":memory:");
  setAuthDb(db);
  createOrgStore({ id: "sumorg", name: "Sum", description: "", websites: [], context: "", createdAt: new Date().toISOString() });
  await db.createAccount({ username: "devon", password: "password1", orgId: "sumorg", userId: "devon" });
  token = db.issueToken("devon", "device", "Mac").token;
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const call = async () => {
  const { POST } = await import("../../app/v1/summaries/route");
  const body = { blocks: [{ app_name: "Mail", window_title: "Re: pricing", started_at: "2026-10-14T10:00:00Z", ended_at: "2026-10-14T10:05:00Z", snippet: "hi" }] };
  const req = new NextRequest("http://localhost/v1/summaries", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({}) } as never);
};

describe("POST /v1/summaries", () => {
  it("is refused while capture is paused or before the notice is accepted, like sending work", async () => {
    const { getStore } = await import("@/http/deps");
    const store = getStore("sumorg");
    saveOrgSettings(store, { captureEnabled: false });
    expect((await call()).status).toBe(403);
    saveOrgSettings(store, { captureEnabled: true });
    const res = await call();
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).toContain("consent_required");
    db.setConsent("devon", 1);
    const ok = await call();
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ summary: expect.stringContaining("Re: pricing") });
  });
});
