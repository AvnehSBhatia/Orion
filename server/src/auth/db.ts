import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "@/config";
import { randomInt, randomUUID } from "node:crypto";
import { hashPassword, newId, newRawToken, sha256 } from "./crypto";

/** session: the web app's cookie. api: MCP, the extension, CI. device: a connected Mac, valid only on /v1. */
/** session: web sign-in. api: MCP and scripts, acts as the person. device: a Mac, /v1 only. ci: GitHub sync, code ingest only. */
export type TokenKind = "session" | "api" | "device" | "ci";

export type Account = {
  username: string;
  orgId: string;
  userId: string;
  admin: boolean;
  createdAt: string;
  email: string | null;
  disabled: boolean;
  lastSeenAt: string | null;
  /** The monitoring notice version this account accepted (0: none yet). */
  consentVersion: number;
  consentAt: string | null;
};

/** Who is calling: the account behind a session cookie or bearer token. */
export type Principal = Account & { tokenId: string; kind: TokenKind };

export type TokenInfo = { id: string; kind: TokenKind; label: string; createdAt: string; expiresAt: string | null; lastUsedAt: string | null };

export type Invite = {
  id: string;
  orgId: string;
  admin: boolean;
  role: string | null;
  /** Who it was sent to, when the admin gave an email (and their name). */
  email: string | null;
  name: string | null;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  usedBy: string | null;
};

export const SESSION_DAYS = 30;
/** How long a "Connect your Mac" code works. */
export const DEVICE_CODE_MINUTES = 15;
/** Letters and digits a person cannot misread: no 0/O, no 1/I. */
const DEVICE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const INVITE_DAYS = 7;
export const RESET_HOURS = 24;
const DAY = 86_400_000;
const HOUR = 3_600_000;

type AccountRow = {
  username: string;
  password_hash: string;
  org_id: string;
  user_id: string;
  admin: number;
  created_at: string;
  email: string | null;
  disabled: number | null;
  last_seen_at: string | null;
  consent_version: number | null;
  consent_at: string | null;
};
type TokenRow = { id: string; hash: string; username: string; kind: TokenKind; label: string; created_at: string; expires_at: string | null; last_used_at: string | null };
type InviteRow = { id: string; hash: string; org_id: string; admin: number; role: string | null; email: string | null; name: string | null; created_by: string; created_at: string; expires_at: string; used_by: string | null };

const toAccount = (r: AccountRow): Account => ({
  username: r.username,
  orgId: r.org_id,
  userId: r.user_id,
  admin: r.admin === 1,
  createdAt: r.created_at,
  email: r.email ?? null,
  disabled: r.disabled === 1,
  lastSeenAt: r.last_seen_at ?? null,
  consentVersion: r.consent_version ?? 0,
  consentAt: r.consent_at ?? null,
});
const toTokenInfo = (r: TokenRow): TokenInfo => ({ id: r.id, kind: r.kind, label: r.label, createdAt: r.created_at, expiresAt: r.expires_at, lastUsedAt: r.last_used_at });
const toInvite = (r: InviteRow): Invite => ({
  id: r.id,
  orgId: r.org_id,
  admin: r.admin === 1,
  role: r.role,
  email: r.email ?? null,
  name: r.name ?? null,
  createdBy: r.created_by,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  usedBy: r.used_by,
});

export const normalizeUsername = (u: string) => u.trim().toLowerCase();
export const normalizeEmail = (e: string) => e.trim().toLowerCase();
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,39}$/;
export const MIN_PASSWORD = 8;

function addColumns(db: Database.Database, table: string, cols: Record<string, string>): void {
  const have = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
  for (const [name, type] of Object.entries(cols)) if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
}

/**
 * Files made before device and CI tokens existed have a CHECK that refuses those kinds. SQLite cannot alter a CHECK,
 * so the table is rebuilt once, in one transaction, keeping every row (nothing references tokens).
 */
function allowTokenKinds(db: Database.Database): void {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tokens'").get() as { sql: string } | undefined;
  if (!row || row.sql.includes("'ci'")) return;
  db.transaction(() => {
    db.exec(`
      CREATE TABLE tokens_new (
        id TEXT PRIMARY KEY,
        hash TEXT NOT NULL UNIQUE,
        username TEXT NOT NULL REFERENCES accounts(username) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('session', 'api', 'device', 'ci')),
        label TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        expires_at TEXT,
        last_used_at TEXT
      );
      INSERT INTO tokens_new (id, hash, username, kind, label, created_at, expires_at, last_used_at)
        SELECT id, hash, username, kind, label, created_at, expires_at, last_used_at FROM tokens;
      DROP TABLE tokens;
      ALTER TABLE tokens_new RENAME TO tokens;
      CREATE INDEX IF NOT EXISTS tokens_username ON tokens(username);
    `);
  })();
}

/** "k7qf-2m9d", "K7QF2M9D" and " k7qf 2m9d " are the same code. */
export const normalizeDeviceCode = (code: string) => code.toUpperCase().replace(/[\s-]/g, "");

/** Accounts, token hashes, invites, reset links, and the audit log, in their own SQLite file apart from the org data. */
export class AuthDb {
  constructor(readonly db: Database.Database) {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        username TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        org_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        admin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tokens (
        id TEXT PRIMARY KEY,
        hash TEXT NOT NULL UNIQUE,
        username TEXT NOT NULL REFERENCES accounts(username) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('session', 'api', 'device', 'ci')),
        label TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        expires_at TEXT,
        last_used_at TEXT
      );
      CREATE INDEX IF NOT EXISTS tokens_username ON tokens(username);
      CREATE TABLE IF NOT EXISTS device_codes (
        hash TEXT PRIMARY KEY,
        username TEXT NOT NULL REFERENCES accounts(username) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT
      );
      CREATE TABLE IF NOT EXISTS invites (
        id TEXT PRIMARY KEY,
        hash TEXT NOT NULL UNIQUE,
        org_id TEXT NOT NULL,
        admin INTEGER NOT NULL DEFAULT 0,
        role TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_by TEXT,
        used_at TEXT
      );
      CREATE INDEX IF NOT EXISTS invites_org ON invites(org_id);
      CREATE TABLE IF NOT EXISTS resets (
        hash TEXT PRIMARY KEY,
        username TEXT NOT NULL REFERENCES accounts(username) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id TEXT,
        at TEXT NOT NULL,
        actor TEXT,
        action TEXT NOT NULL,
        target TEXT,
        detail TEXT
      );
      CREATE INDEX IF NOT EXISTS audit_org ON audit(org_id, id);
    `);
    // Files made before these columns existed get them on open.
    addColumns(db, "accounts", {
      email: "TEXT",
      disabled: "INTEGER NOT NULL DEFAULT 0",
      last_seen_at: "TEXT",
      consent_version: "INTEGER NOT NULL DEFAULT 0",
      consent_at: "TEXT",
    });
    addColumns(db, "invites", { email: "TEXT", name: "TEXT" });
    allowTokenKinds(db);
    // One account per email, so signing in with it is unambiguous. The code checks first (a clear 409); the index
    // backs it. A file that already holds duplicates opens without it, and they are refused from then on.
    try {
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS accounts_email ON accounts(email COLLATE NOCASE)");
    } catch (err) {
      console.warn("auth.db: two accounts share an email; sign-in with those emails is refused until one changes", err instanceof Error ? err.message : err);
    }
  }

  static open(file: string): AuthDb {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    return new AuthDb(new Database(file));
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // Accounts

  async createAccount(a: { username: string; password: string; orgId: string; userId: string; admin?: boolean; email?: string | null }): Promise<Account> {
    const username = normalizeUsername(a.username);
    if (!USERNAME_RE.test(username)) throw new Error("username must be 2-40 lowercase letters, digits, dots, dashes, or underscores");
    if (a.password.length < MIN_PASSWORD) throw new Error(`password must be at least ${MIN_PASSWORD} characters`);
    if (this.getAccount(username)) throw new Error(`username "${username}" is taken`);
    const email = a.email ? normalizeEmail(a.email) : null;
    if (email && this.accountByEmail(email)) throw new Error("another account already uses that email");
    const hash = await hashPassword(a.password);
    this.db
      .prepare("INSERT INTO accounts (username, password_hash, org_id, user_id, admin, created_at, email) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(username, hash, a.orgId, a.userId, a.admin ? 1 : 0, new Date().toISOString(), email);
    return this.getAccount(username)!;
  }

  /** Sets a new password and signs out every session except `keepTokenId` (the one that made the change). */
  async setPassword(username: string, password: string, keepTokenId?: string): Promise<void> {
    if (password.length < MIN_PASSWORD) throw new Error(`password must be at least ${MIN_PASSWORD} characters`);
    const u = normalizeUsername(username);
    this.db.prepare("UPDATE accounts SET password_hash = ? WHERE username = ?").run(await hashPassword(password), u);
    this.db.prepare("DELETE FROM tokens WHERE username = ? AND kind = 'session' AND id IS NOT ?").run(u, keepTokenId ?? null);
  }

  getAccount(username: string): Account | null {
    const r = this.db.prepare("SELECT * FROM accounts WHERE username = ?").get(normalizeUsername(username)) as AccountRow | undefined;
    return r ? toAccount(r) : null;
  }

  /** The account with this email (any case), or null. Null too when two share it (a file from before the index). */
  accountByEmail(email: string): Account | null {
    const rows = this.db.prepare("SELECT * FROM accounts WHERE email = ? COLLATE NOCASE LIMIT 2").all(normalizeEmail(email)) as AccountRow[];
    return rows.length === 1 ? toAccount(rows[0]) : null;
  }

  listAccounts(orgId: string): Account[] {
    return (this.db.prepare("SELECT * FROM accounts WHERE org_id = ? ORDER BY username").all(orgId) as AccountRow[]).map(toAccount);
  }

  accountsForUser(orgId: string, userId: string): Account[] {
    return (this.db.prepare("SELECT * FROM accounts WHERE org_id = ? AND user_id = ?").all(orgId, userId) as AccountRow[]).map(toAccount);
  }

  /** Changes admin, disabled, or email. Disabling revokes every session and token of the account. */
  updateAccount(username: string, patch: { admin?: boolean; disabled?: boolean; email?: string | null }): Account | null {
    const u = normalizeUsername(username);
    this.transaction(() => {
      if (patch.admin !== undefined) this.db.prepare("UPDATE accounts SET admin = ? WHERE username = ?").run(patch.admin ? 1 : 0, u);
      if (patch.email !== undefined) this.db.prepare("UPDATE accounts SET email = ? WHERE username = ?").run(patch.email ? normalizeEmail(patch.email) : null, u);
      if (patch.disabled !== undefined) {
        this.db.prepare("UPDATE accounts SET disabled = ? WHERE username = ?").run(patch.disabled ? 1 : 0, u);
        if (patch.disabled) this.db.prepare("DELETE FROM tokens WHERE username = ?").run(u);
      }
    });
    return this.getAccount(u);
  }

  /** Active admins of the org (not disabled). */
  activeAdmins(orgId: string): string[] {
    return (this.db.prepare("SELECT username FROM accounts WHERE org_id = ? AND admin = 1 AND disabled = 0").all(orgId) as { username: string }[]).map((r) => r.username);
  }

  setConsent(username: string, version: number): Account | null {
    this.db.prepare("UPDATE accounts SET consent_version = ?, consent_at = ? WHERE username = ?").run(version, new Date().toISOString(), normalizeUsername(username));
    return this.getAccount(username);
  }

  deleteAccount(username: string): boolean {
    return this.db.prepare("DELETE FROM accounts WHERE username = ?").run(normalizeUsername(username)).changes > 0;
  }

  /** Removes every account (and so every token and reset link) and invite of an org. */
  deleteOrg(orgId: string): number {
    return this.transaction(() => {
      this.db.prepare("DELETE FROM invites WHERE org_id = ?").run(orgId);
      return this.db.prepare("DELETE FROM accounts WHERE org_id = ?").run(orgId).changes;
    });
  }

  passwordHash(username: string): string | null {
    const r = this.db.prepare("SELECT password_hash FROM accounts WHERE username = ?").get(normalizeUsername(username)) as { password_hash: string } | undefined;
    return r?.password_hash ?? null;
  }

  // Tokens

  /** Returns the raw token; only its hash is stored. Sessions expire after 30 days; other kinds at `expiresAt`, if given. */
  issueToken(username: string, kind: TokenKind, label = "", expiresAt: string | null = null): { token: string; info: TokenInfo } {
    const raw = newRawToken();
    // A device's token id is its device_id, a UUID as the Mac contract says.
    const id = kind === "device" ? randomUUID() : newId();
    const now = new Date();
    const expires = kind === "session" ? new Date(now.getTime() + SESSION_DAYS * DAY).toISOString() : expiresAt;
    this.db
      .prepare("INSERT INTO tokens (id, hash, username, kind, label, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, sha256(raw), normalizeUsername(username), kind, label.slice(0, 80), now.toISOString(), expires);
    return { token: raw, info: this.tokenById(id)! };
  }

  /** The account behind a raw token, or null when unknown, expired, or the account is disabled. */
  resolveToken(raw: string): Principal | null {
    if (!raw) return null;
    const t = this.db.prepare("SELECT * FROM tokens WHERE hash = ?").get(sha256(raw)) as TokenRow | undefined;
    if (!t) return null;
    const now = Date.now();
    if (t.expires_at && Date.parse(t.expires_at) <= now) {
      this.db.prepare("DELETE FROM tokens WHERE id = ?").run(t.id);
      return null;
    }
    const a = this.getAccount(t.username);
    if (!a || a.disabled) return null;
    // At most one write a minute per token.
    if (!t.last_used_at || now - Date.parse(t.last_used_at) > 60_000) {
      const at = new Date(now).toISOString();
      this.db.prepare("UPDATE tokens SET last_used_at = ? WHERE id = ?").run(at, t.id);
      this.db.prepare("UPDATE accounts SET last_seen_at = ? WHERE username = ?").run(at, t.username);
    }
    return { ...a, tokenId: t.id, kind: t.kind };
  }

  tokenById(id: string): (TokenInfo & { username: string }) | null {
    const r = this.db.prepare("SELECT * FROM tokens WHERE id = ?").get(id) as TokenRow | undefined;
    return r ? { ...toTokenInfo(r), username: r.username } : null;
  }

  listTokens(username: string): TokenInfo[] {
    return (this.db.prepare("SELECT * FROM tokens WHERE username = ? ORDER BY created_at DESC").all(normalizeUsername(username)) as TokenRow[]).map(toTokenInfo);
  }

  revokeToken(id: string): boolean {
    return this.db.prepare("DELETE FROM tokens WHERE id = ?").run(id).changes > 0;
  }

  /** Deletes expired sessions, reset links, device codes, and unused invites. */
  sweep(now = Date.now()): void {
    const at = new Date(now).toISOString();
    this.db.prepare("DELETE FROM tokens WHERE expires_at IS NOT NULL AND expires_at <= ?").run(at);
    this.db.prepare("DELETE FROM resets WHERE expires_at <= ?").run(at);
    this.db.prepare("DELETE FROM device_codes WHERE expires_at <= ?").run(at);
  }

  // "Connect your Mac" codes

  /** A one-time code like "K7QF-2M9D" for 15 minutes. Only its hash is stored. */
  createDeviceCode(username: string, now = Date.now()): { code: string; expiresAt: string } {
    const chars = Array.from({ length: 8 }, () => DEVICE_CODE_ALPHABET[randomInt(DEVICE_CODE_ALPHABET.length)]).join("");
    const expiresAt = new Date(now + DEVICE_CODE_MINUTES * 60_000).toISOString();
    this.db
      .prepare("INSERT INTO device_codes (hash, username, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(sha256(chars), normalizeUsername(username), new Date(now).toISOString(), expiresAt);
    return { code: `${chars.slice(0, 4)}-${chars.slice(4)}`, expiresAt };
  }

  /** Spends a device code: the account that made it, or null when unknown, used, expired, or the account is disabled. */
  consumeDeviceCode(code: string, now = Date.now()): Account | null {
    const norm = normalizeDeviceCode(code);
    if (!/^[A-Z0-9]{8}$/.test(norm)) return null;
    const at = new Date(now).toISOString();
    const hash = sha256(norm);
    const r = this.db.prepare("SELECT username FROM device_codes WHERE hash = ? AND used_at IS NULL AND expires_at > ?").get(hash, at) as
      | { username: string }
      | undefined;
    if (!r) return null;
    // The guarded UPDATE leaves one winner when two registrations race with the same code.
    if (this.db.prepare("UPDATE device_codes SET used_at = ? WHERE hash = ? AND used_at IS NULL").run(at, hash).changes === 0) return null;
    const a = this.getAccount(r.username);
    return a && !a.disabled ? a : null;
  }

  // Invites

  /** A one-use invite into an org. Returns the raw token (only its hash is stored). */
  createInvite(i: { orgId: string; admin?: boolean; role?: string | null; email?: string | null; name?: string | null; createdBy: string }): { token: string; invite: Invite } {
    const raw = newRawToken();
    const id = newId();
    const now = Date.now();
    this.db
      .prepare("INSERT INTO invites (id, hash, org_id, admin, role, email, name, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        id,
        sha256(raw),
        i.orgId,
        i.admin ? 1 : 0,
        i.role ?? null,
        i.email ? normalizeEmail(i.email) : null,
        i.name ?? null,
        i.createdBy,
        new Date(now).toISOString(),
        new Date(now + INVITE_DAYS * DAY).toISOString(),
      );
    return { token: raw, invite: this.inviteById(id)! };
  }

  inviteById(id: string): Invite | null {
    const r = this.db.prepare("SELECT * FROM invites WHERE id = ?").get(id) as InviteRow | undefined;
    return r ? toInvite(r) : null;
  }

  /** The invite behind a raw token while it is unused and unexpired. */
  openInvite(raw: string, now = Date.now()): Invite | null {
    if (!raw) return null;
    const r = this.db.prepare("SELECT * FROM invites WHERE hash = ?").get(sha256(raw)) as InviteRow | undefined;
    if (!r || r.used_by || Date.parse(r.expires_at) <= now) return null;
    return toInvite(r);
  }

  listInvites(orgId: string): Invite[] {
    return (this.db.prepare("SELECT * FROM invites WHERE org_id = ? ORDER BY created_at DESC").all(orgId) as InviteRow[]).map(toInvite);
  }

  /** Marks an invite used; false when someone used it first. */
  useInvite(id: string, username: string): boolean {
    return this.db.prepare("UPDATE invites SET used_by = ?, used_at = ? WHERE id = ? AND used_by IS NULL").run(username, new Date().toISOString(), id).changes > 0;
  }

  deleteInvite(id: string): boolean {
    return this.db.prepare("DELETE FROM invites WHERE id = ?").run(id).changes > 0;
  }

  // Password reset links

  /** A one-time reset link for 24 hours. Issuing a new one cancels older ones. */
  createReset(username: string): { token: string; expiresAt: string } {
    const u = normalizeUsername(username);
    const raw = newRawToken();
    const now = Date.now();
    const expiresAt = new Date(now + RESET_HOURS * HOUR).toISOString();
    this.transaction(() => {
      this.db.prepare("DELETE FROM resets WHERE username = ?").run(u);
      this.db.prepare("INSERT INTO resets (hash, username, created_at, expires_at) VALUES (?, ?, ?, ?)").run(sha256(raw), u, new Date(now).toISOString(), expiresAt);
    });
    return { token: raw, expiresAt };
  }

  /** Spends a reset token: the username it was for, or null when unknown or expired. */
  consumeReset(raw: string, now = Date.now()): string | null {
    if (!raw) return null;
    const r = this.db.prepare("SELECT * FROM resets WHERE hash = ?").get(sha256(raw)) as { username: string; expires_at: string } | undefined;
    if (!r) return null;
    this.db.prepare("DELETE FROM resets WHERE hash = ?").run(sha256(raw));
    return Date.parse(r.expires_at) > now ? r.username : null;
  }
}

export const authDbPath = () => path.join(config.dataDir, "auth.db");

const g = globalThis as typeof globalThis & { __orionAuth?: AuthDb };

/** One handle per process (survives dev hot reloads). */
export function getAuthDb(): AuthDb {
  if (g.__orionAuth && !(g.__orionAuth instanceof AuthDb)) g.__orionAuth = undefined;
  return (g.__orionAuth ??= AuthDb.open(authDbPath()));
}

/** Tests: swap in an in-memory database. */
export function setAuthDb(db: AuthDb | undefined): void {
  g.__orionAuth = db;
}
