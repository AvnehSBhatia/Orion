import { describe, expect, it } from "vitest";
import { listAudit } from "@/audit/log";
import { AuthDb, type Principal } from "@/auth/db";
import type { Store } from "@/db/store";
import { memoryStore } from "@/test/helpers";
import { deleteCapturesBy, deleteMyCaptures, deletePerson } from "./deletion";
import { captureGate, capturePolicy, updateSettingsAs } from "./policy";
import { getOrgSettings, isExcludedUrl, normalizeHost, orgSettingsPatch } from "./settings";
import { canSeeImage, maskImages, screenshotResponse } from "./visibility";

const NOW = "2026-10-14T12:00:00.000Z";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);

function principal(over: Partial<Principal> = {}): Principal {
  return {
    username: "devon",
    orgId: "acme",
    userId: "devon",
    admin: false,
    createdAt: NOW,
    email: null,
    disabled: false,
    lastSeenAt: null,
    consentVersion: 0,
    consentAt: null,
    tokenId: "t",
    kind: "session",
    ...over,
  };
}

/** Two people, one node, and a document each (with a screenshot, its change, summary, facet, and a shared digest). */
function fixture(): Store {
  const store = memoryStore();
  store.saveUser({ id: "devon", name: "Devon", role: "Engineer", teamDescription: "" });
  store.saveUser({ id: "priya", name: "Priya", role: "Sales", teamDescription: "" });
  store.db
    .prepare(
      `INSERT INTO nodes (id, key, label, type, domain, summary, status, source_kind, source_ref, updated_at)
       VALUES ('n1', 'n1', 'Checkout', 'feature', 'engineering', 's', 'on_track', 'capture', 'x', ?)`,
    )
    .run(NOW);
  const src = store.db.prepare("INSERT INTO sources (id, kind, ref, title, text, author_id, image, created_at) VALUES (?, 'capture', ?, 't', 'text', ?, ?, ?)");
  src.run("src-d", "https://a.example/1", "devon", PNG, NOW);
  src.run("src-p", "https://a.example/2", "priya", PNG, NOW);
  for (const id of ["src-d", "src-p"]) {
    store.db.prepare("INSERT INTO source_changes (source_id, node_id, change, status_to) VALUES (?, 'n1', 'updated', 'on_track')").run(id);
    store.db.prepare("INSERT INTO summaries (source_id, text, text_hash, fidelity) VALUES (?, 's', 'h', 1)").run(id);
    store.db.prepare("INSERT INTO facets (item_kind, item_id, area, use, text_hash, created_at) VALUES ('source', ?, 'a', 'u', 'h', ?)").run(id, NOW);
  }
  store.addTouches("devon", ["n1"]);
  store.addTouches("priya", ["n1"]);
  store.db
    .prepare("INSERT INTO digests (id, title, text, members, members_key, fidelity, newest_at, created_at) VALUES ('dg-1', 't', 'x', ?, 'k', 1, ?, ?)")
    .run(JSON.stringify(["src-d", "src-p"]), NOW, NOW);
  return store;
}

const count = (store: Store, sql: string) => (store.db.prepare(sql).get() as { n: number }).n;

describe("settings", () => {
  it("normalizes hosts and refuses bad or unknown fields", () => {
    expect(normalizeHost("https://www.Mail.Google.com/inbox")).toBe("mail.google.com");
    expect(normalizeHost("bank.example.")).toBe("bank.example");
    expect(normalizeHost("not a host")).toBeNull();
    expect(orgSettingsPatch.parse({ excludedHosts: ["Mail.google.com", "https://mail.google.com/x", "bank.example"] })).toEqual({
      excludedHosts: ["mail.google.com", "bank.example"],
    });
    expect(orgSettingsPatch.safeParse({ excludedHosts: ["???"] }).success).toBe(false);
    expect(orgSettingsPatch.safeParse({ captureIntervalSec: 0 }).success).toBe(false);
    expect(orgSettingsPatch.safeParse({ screenshotVisibility: "everyone" }).success).toBe(false);
    expect(orgSettingsPatch.safeParse({ surprise: true }).success).toBe(false);
  });

  it("saves a patch over the defaults and audits only keys that changed", () => {
    const store = memoryStore();
    const db = AuthDb.open(":memory:");
    const s = updateSettingsAs(db, store, principal({ admin: true, username: "boss" }), "acme", { captureEnabled: false, retentionDays: 90 });
    expect(s).toMatchObject({ captureEnabled: false, retentionDays: 90, consentVersion: 1 });
    expect(getOrgSettings(store).captureEnabled).toBe(false);
    expect(listAudit(db, "acme")).toEqual([expect.objectContaining({ action: "settings_changed", actor: "boss", detail: JSON.stringify({ changed: ["captureEnabled"] }) })]);
  });
});

describe("capture policy", () => {
  it("pauses, asks for consent, then skips excluded hosts", () => {
    const store = memoryStore();
    const fresh = principal();
    expect(capturePolicy(store, fresh)).toEqual({ captureEnabled: true, excludedHosts: [], captureIntervalSec: 5, consent: { required: true, version: 1 } });
    expect(() => captureGate(store, fresh, "https://x.example")).toThrow(expect.objectContaining({ status: 403, message: "consent required" }));
    const consented = principal({ consentVersion: 1, consentAt: NOW });
    expect(captureGate(store, consented, "https://x.example")).toBeNull();
    store.db.exec("DELETE FROM org_settings");
    updateSettingsAs(AuthDb.open(":memory:"), store, null, "acme", { excludedHosts: ["mail.google.com"] });
    expect(captureGate(store, consented, "https://www.mail.google.com/u/0")).toBe("excluded");
    expect(isExcludedUrl(getOrgSettings(store), "https://docs.google.com")).toBe(false);
    updateSettingsAs(AuthDb.open(":memory:"), store, null, "acme", { captureEnabled: false });
    expect(() => captureGate(store, consented, "https://x.example")).toThrow(expect.objectContaining({ status: 403, message: "capture paused by your admin" }));
    expect(capturePolicy(store, null).consent.required).toBe(false);
  });
});

describe("screenshot visibility", () => {
  it("lets the author, admins, or everyone (org setting) open a screenshot", () => {
    const authorOnly = { screenshotVisibility: "author_and_admins" as const };
    expect(canSeeImage(principal(), authorOnly, "devon")).toBe(true);
    expect(canSeeImage(principal(), authorOnly, "priya")).toBe(false);
    expect(canSeeImage(principal(), authorOnly, null)).toBe(false);
    expect(canSeeImage(principal({ admin: true }), authorOnly, "priya")).toBe(true);
    expect(canSeeImage(principal(), { screenshotVisibility: "org" }, "priya")).toBe(true);
    expect(canSeeImage(null, authorOnly, "priya")).toBe(true);
  });

  it("serves or refuses the image and masks hasImage", async () => {
    const store = fixture();
    const devon = principal();
    expect(screenshotResponse(devon, store, "src-d").headers.get("content-type")).toBe("image/png");
    expect(() => screenshotResponse(devon, store, "src-p")).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => screenshotResponse(devon, store, "src-none")).toThrow(expect.objectContaining({ status: 404 }));
    const sources = ["src-d", "src-p"].map((id) => store.toPublicSource(store.getSource(id)!));
    expect(maskImages(devon, store, sources).map((s) => s.hasImage)).toEqual([true, false]);
    expect(maskImages(principal({ admin: true }), store, sources).map((s) => s.hasImage)).toEqual([true, true]);
  });
});

describe("deletion", () => {
  it("removes a person's documents, screenshots, changes, digests, and touches, and keeps the graph", () => {
    const store = fixture();
    expect(deleteCapturesBy(store, "devon")).toBe(1);
    expect(store.getSource("src-d")).toBeNull();
    expect(store.getSource("src-p")).not.toBeNull();
    expect(count(store, "SELECT count(*) n FROM source_changes WHERE source_id = 'src-d'")).toBe(0);
    expect(count(store, "SELECT count(*) n FROM summaries WHERE source_id = 'src-d'")).toBe(0);
    expect(count(store, "SELECT count(*) n FROM facets WHERE item_id = 'src-d'")).toBe(0);
    expect(count(store, "SELECT count(*) n FROM digests")).toBe(0);
    expect(store.touchedNodeIds("devon")).toEqual([]);
    expect([...store.touchedNodeIds("priya")]).toEqual(["n1"]);
    expect(store.getNode("n1")).not.toBeNull();
    expect(count(store, "SELECT count(*) n FROM source_changes WHERE source_id = 'src-p'")).toBe(1);
  });

  it("deletes your own captures with an audit entry", () => {
    const store = fixture();
    const db = AuthDb.open(":memory:");
    expect(deleteMyCaptures(db, store, principal())).toEqual({ deleted: 1 });
    expect(listAudit(db, "acme")[0]).toMatchObject({ action: "data_deleted", actor: "devon", target: "devon" });
  });

  it("removes a person and their accounts, but never the last admin or yourself", async () => {
    const store = fixture();
    const db = AuthDb.open(":memory:");
    await db.createAccount({ username: "boss", password: "password1", orgId: "acme", userId: "boss", admin: true });
    await db.createAccount({ username: "priya", password: "password1", orgId: "acme", userId: "priya" });
    const priyaToken = db.issueToken("priya", "api").token;
    const boss = principal({ username: "boss", userId: "boss", admin: true });
    expect(() => deletePerson(db, store, boss, "acme", "boss")).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => deletePerson(db, store, boss, "acme", "nobody")).toThrow(expect.objectContaining({ status: 404 }));
    expect(deletePerson(db, store, boss, "acme", "priya")).toEqual({ deleted: 1 });
    expect(store.getUser("priya")).toBeNull();
    expect(db.getAccount("priya")).toBeNull();
    expect(db.resolveToken(priyaToken)).toBeNull();
    expect(store.getNode("n1")).not.toBeNull();
    // The only admin's person cannot be removed by someone acting without an account (auth disabled).
    expect(() => deletePerson(db, store, null, "acme", "boss")).toThrow(expect.objectContaining({ status: 409 }));
  });
});
