import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "@/config";
import { hashPassword, newId, newRawToken, sha256 } from "./crypto";

export type TokenKind = "session" | "api";

export type Account = { username: string; orgId: string; userId: string; admin: boolean; createdAt: string };

/** Who is calling: the account behind a session cookie or bearer token. */
export type Principal = Account & { tokenId: string; kind: TokenKind };

export type TokenInfo = { id: string; kind: TokenKind; label: string; createdAt: string; expiresAt: string | null; lastUsedAt: string | null };

export const SESSION_DAYS = 30;
const DAY = 86_400_000;

type AccountRow = { username: string; password_hash: string; org_id: string; user_id: string; admin: number; created_at: string };
type TokenRow = { id: string; hash: string; username: string; kind: TokenKind; label: string; created_at: string; expires_at: string | null; last_used_at: string | null };

const toAccount = (r: AccountRow): Account => ({ username: r.username, orgId: r.org_id, userId: r.user_id, admin: r.admin === 1, createdAt: r.created_at });
const toTokenInfo = (r: TokenRow): TokenInfo => ({ id: r.id, kind: r.kind, label: r.label, createdAt: r.created_at, expiresAt: r.expires_at, lastUsedAt: r.last_used_at });

export const normalizeUsername = (u: string) => u.trim().toLowerCase();
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,39}$/;
export const MIN_PASSWORD = 8;

/** Accounts and token hashes, in their own SQLite file apart from the org data. */
export class AuthDb {
  constructor(readonly db: Database.Database) {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
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
        kind TEXT NOT NULL CHECK (kind IN ('session', 'api')),
        label TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        expires_at TEXT,
        last_used_at TEXT
      );
      CREATE INDEX IF NOT EXISTS tokens_username ON tokens(username);
    `);
  }

  static open(file: string): AuthDb {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    return new AuthDb(new Database(file));
  }

  async createAccount(a: { username: string; password: string; orgId: string; userId: string; admin?: boolean }): Promise<Account> {
    const username = normalizeUsername(a.username);
    if (!USERNAME_RE.test(username)) throw new Error("username must be 2-40 lowercase letters, digits, dots, dashes, or underscores");
    if (a.password.length < MIN_PASSWORD) throw new Error(`password must be at least ${MIN_PASSWORD} characters`);
    if (this.getAccount(username)) throw new Error(`username "${username}" is taken`);
    const hash = await hashPassword(a.password);
    this.db
      .prepare("INSERT INTO accounts (username, password_hash, org_id, user_id, admin, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(username, hash, a.orgId, a.userId, a.admin ? 1 : 0, new Date().toISOString());
    return this.getAccount(username)!;
  }

  async setPassword(username: string, password: string): Promise<void> {
    if (password.length < MIN_PASSWORD) throw new Error(`password must be at least ${MIN_PASSWORD} characters`);
    const u = normalizeUsername(username);
    this.db.prepare("UPDATE accounts SET password_hash = ? WHERE username = ?").run(await hashPassword(password), u);
    // A new password signs out every session.
    this.db.prepare("DELETE FROM tokens WHERE username = ? AND kind = 'session'").run(u);
  }

  getAccount(username: string): Account | null {
    const r = this.db.prepare("SELECT * FROM accounts WHERE username = ?").get(normalizeUsername(username)) as AccountRow | undefined;
    return r ? toAccount(r) : null;
  }

  passwordHash(username: string): string | null {
    const r = this.db.prepare("SELECT password_hash FROM accounts WHERE username = ?").get(normalizeUsername(username)) as { password_hash: string } | undefined;
    return r?.password_hash ?? null;
  }

  /** Returns the raw token; only its hash is stored. Sessions expire after 30 days, API tokens never. */
  issueToken(username: string, kind: TokenKind, label = ""): { token: string; info: TokenInfo } {
    const raw = newRawToken();
    const id = newId();
    const now = new Date();
    const expires = kind === "session" ? new Date(now.getTime() + SESSION_DAYS * DAY).toISOString() : null;
    this.db
      .prepare("INSERT INTO tokens (id, hash, username, kind, label, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, sha256(raw), normalizeUsername(username), kind, label.slice(0, 80), now.toISOString(), expires);
    return { token: raw, info: this.tokenById(id)! };
  }

  /** The account behind a raw token, or null when unknown or expired. */
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
    if (!a) return null;
    // At most one write a minute per token.
    if (!t.last_used_at || now - Date.parse(t.last_used_at) > 60_000) {
      this.db.prepare("UPDATE tokens SET last_used_at = ? WHERE id = ?").run(new Date(now).toISOString(), t.id);
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
