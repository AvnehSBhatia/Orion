import { describe, expect, it } from "vitest";
import { audit, listAudit } from "@/audit/log";
import { AuthDb, type Principal } from "@/auth/db";
import { sha256 } from "@/auth/crypto";
import { submitWorkBlocks } from "@/mac/workBlocks";
import { deps, memoryStore } from "@/test/helpers";
import { buildPersonExport, exportPerson, exportResponse } from "./export";

const NOW = "2026-10-14T12:00:00.000Z";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);

const block = (id: string, title: string, snippet: string) => ({
  local_id: id,
  started_at: "2026-10-14T10:00:00.000Z",
  ended_at: "2026-10-14T10:05:00.000Z",
  app_name: "Mail",
  window_title: title,
  match_method: "none",
  match_confidence: 0,
  snippet,
});

/** Devon and Priya, each with an account, a token, a capture (Devon's with a screenshot), Mac blocks, and audit events. */
async function fixture() {
  const store = memoryStore();
  const db = AuthDb.open(":memory:");
  store.saveUser({ id: "devon", name: "Devon", role: "Engineer", teamDescription: "Checkout team" });
  store.saveUser({ id: "priya", name: "Priya", role: "Sales", teamDescription: "" });
  await db.createAccount({ username: "devon", password: "password1", orgId: "acme", userId: "devon", email: "devon@acme.test" });
  await db.createAccount({ username: "priya", password: "password1", orgId: "acme", userId: "priya" });
  await db.createAccount({ username: "boss", password: "password1", orgId: "acme", userId: "boss", admin: true });
  db.setConsent("devon", 1);
  const devonToken = db.issueToken("devon", "api", "laptop");
  db.issueToken("priya", "api", "priya laptop");
  const node = store.db.prepare(
    `INSERT INTO nodes (id, key, label, type, domain, summary, owner, status, source_kind, source_ref, updated_at)
     VALUES (?, ?, ?, 'feature', 'engineering', ?, ?, 'on_track', 'capture', 'x', ?)`,
  );
  node.run("n1", "n1", "Checkout", "New checkout flow", "Devon", NOW);
  node.run("n2", "n2", "Pipeline", "Q4 pipeline", "Priya", NOW);
  node.run("n3", "n3", "Billing", "Billing page", null, NOW);
  const src = store.db.prepare("INSERT INTO sources (id, kind, ref, title, text, author_id, image, created_at) VALUES (?, 'capture', ?, ?, ?, ?, ?, ?)");
  src.run("src-d", "https://a.example/1", "Devon's page", "devon page text", "devon", PNG, NOW);
  src.run("src-p", "https://a.example/2", "Priya's page", "priya page text", "priya", null, NOW);
  store.db.prepare("INSERT INTO source_changes (source_id, node_id, change, status_to) VALUES ('src-d', 'n3', 'updated', 'on_track')").run();
  store.db.prepare("INSERT INTO source_changes (source_id, node_id, change, status_to) VALUES ('src-p', 'n2', 'updated', 'on_track')").run();
  store.addTouches("devon", ["n1"]);
  store.addTouches("priya", ["n2"]);
  submitWorkBlocks(deps(store), "devon", [block("d1", "Re: Initech pricing", "Initech wants a discount")]);
  submitWorkBlocks(deps(store), "priya", [block("p1", "Priya secret thread", "priya private snippet")]);
  audit(db, { orgId: "acme", actor: "devon", action: "login", target: "devon" });
  audit(db, { orgId: "acme", actor: "boss", action: "viewed_as", target: "devon", detail: { route: "/api/feed" } });
  audit(db, { orgId: "acme", actor: "priya", action: "login", target: "priya" });
  audit(db, { orgId: "other", actor: "devon", action: "login", target: "devon" });
  return { store, db, devonToken };
}

const boss: Principal = {
  username: "boss",
  orgId: "acme",
  userId: "boss",
  admin: true,
  createdAt: NOW,
  email: null,
  disabled: false,
  lastSeenAt: null,
  consentVersion: 1,
  consentAt: NOW,
  tokenId: "t",
  kind: "session",
};

describe("person export", () => {
  it("holds the account, person, documents, Mac data, work items, tokens and audit events", async () => {
    const { store, db } = await fixture();
    const e = buildPersonExport(db, store, "acme", "devon");
    expect(e).toMatchObject({ format: "orion-person-export", version: 1, orgId: "acme", userId: "devon" });
    expect(e.accounts).toEqual([
      expect.objectContaining({ username: "devon", email: "devon@acme.test", role: "member", consent: { version: 1, acceptedAt: expect.any(String) } }),
    ]);
    expect(e.accounts[0].tokens).toEqual([expect.objectContaining({ kind: "api", label: "laptop" })]);
    expect(e.person).toEqual({ id: "devon", name: "Devon", role: "Engineer", teamDescription: "Checkout team" });

    const capture = e.documents.find((d) => d.id === "src-d");
    expect(capture).toMatchObject({ text: "devon page text", hasScreenshot: true, changed: [expect.objectContaining({ itemId: "n3", label: "Billing" })] });
    // The Mac block is a document too (kind "mac"), and its row is in mac.workBlocks.
    expect(e.documents.some((d) => d.kind === "mac")).toBe(true);
    expect(e.mac.workBlocks).toEqual([expect.objectContaining({ local_id: "d1", window_title: "Re: Initech pricing", snippet: "Initech wants a discount" })]);
    expect(e.screenshots).toMatchObject({ count: 1, ids: ["src-d"], howToGet: expect.stringContaining("/api/sources/<id>/image") });

    expect(Object.fromEntries(e.workItems.map((w) => [w.id, w.why]))).toEqual({ n1: ["owner", "touched"], n3: ["changed"] });
    expect(e.auditLog.map((a) => [a.actor, a.action])).toEqual([
      ["devon", "login"],
      ["boss", "viewed_as"],
    ]);
  });

  it("never holds the password hash, token hashes, or anyone else's data", async () => {
    const { store, db, devonToken } = await fixture();
    const text = JSON.stringify(buildPersonExport(db, store, "acme", "devon"));
    expect(text).not.toContain(db.passwordHash("devon")!);
    expect(text).not.toContain(sha256(devonToken.token));
    expect(text).not.toContain(devonToken.token);
    expect(text).not.toMatch(/password_hash|"hash"/);
    for (const theirs of ["priya page text", "Priya secret thread", "priya private snippet", "priya laptop", "Pipeline", "src-p"]) expect(text).not.toContain(theirs);
  });

  it("404s for an unknown person", async () => {
    const { store, db } = await fixture();
    expect(() => buildPersonExport(db, store, "acme", "nobody")).toThrow(expect.objectContaining({ status: 404 }));
  });

  it("downloads as an attachment and is audited with counts only", async () => {
    const { store, db } = await fixture();
    const res = exportResponse(exportPerson(db, store, boss, "acme", "devon"));
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="orion-export-devon-\d{4}-\d{2}-\d{2}\.json"$/);
    const event = listAudit(db, "acme")[0];
    expect(event).toMatchObject({ action: "data_exported", actor: "boss", target: "devon" });
    expect(JSON.parse(event.detail!)).toEqual({ by: "admin", documents: 2, workBlocks: 1, screenshots: 1 });
  });
});
