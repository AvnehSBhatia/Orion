// Accounts for sign-in. Writes $DATA_DIR/auth.db (and the org's SQLite file when it adds the person).
// Usage:
//   npx tsx scripts/account.ts create --username devon --password '...' --org acme --user devon [--admin] [--name "Devon Lee"] [--role "..."]
//     [--org-name "Acme Inc"] [--org-description "..."]   (used when this creates the org)
//   Names left out default to the id in title case: --org acme is "Acme", --user devon-lee is "Devon Lee".
//   npx tsx scripts/account.ts password --username devon --password '...'
//   npx tsx scripts/account.ts token --username devon --label "mcp on laptop"

import { parseArgs } from "node:util";
import { getAuthDb } from "@/auth/db";
import { ensurePerson } from "@/auth/service";
import { createOrgStore, getStore, orgExists } from "@/http/deps";
import { titleFromId } from "@/lib/text";

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    username: { type: "string" },
    password: { type: "string" },
    org: { type: "string" },
    user: { type: "string" },
    name: { type: "string" },
    "org-name": { type: "string" },
    "org-description": { type: "string" },
    role: { type: "string" },
    label: { type: "string" },
    admin: { type: "boolean", default: false },
  },
});

function need(key: keyof typeof values): string {
  const v = values[key];
  if (typeof v !== "string" || !v.trim()) {
    console.error(`missing --${key}`);
    process.exit(1);
  }
  return v.trim();
}

const db = getAuthDb();

async function main() {
  if (command === "create") {
    const username = need("username");
    const password = need("password");
    const orgId = need("org");
    const userId = need("user");
    const orgName = values["org-name"]?.trim() || titleFromId(orgId);
    const store = orgExists(orgId)
      ? getStore(orgId)
      : createOrgStore({
          id: orgId,
          name: orgName,
          description: values["org-description"]?.trim() || orgName,
          websites: [],
          context: "",
          createdAt: new Date().toISOString(),
        });
    const account = await db.createAccount({ username, password, orgId, userId, admin: values.admin });
    if (ensurePerson(store, userId, values.name, values.role)) console.log(`Added ${userId} to org ${orgId}. Their gravity is fit on the next npm run seed or role change.`);
    console.log(`Created ${account.username} (org ${account.orgId}, user ${account.userId}${account.admin ? ", admin" : ""}).`);
  } else if (command === "password") {
    const username = need("username");
    if (!db.getAccount(username)) throw new Error(`no account "${username}"`);
    await db.setPassword(username, need("password"));
    console.log(`Password changed for ${username.toLowerCase()}; their sessions were signed out.`);
  } else if (command === "token") {
    const username = need("username");
    if (!db.getAccount(username)) throw new Error(`no account "${username}"`);
    const { token, info } = db.issueToken(username, "api", values.label ?? "cli");
    console.log(`API token ${info.id} for ${username.toLowerCase()} (shown once):\n${token}`);
  } else {
    console.error("usage: account.ts create|password|token --username ... (see the top of scripts/account.ts)");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
