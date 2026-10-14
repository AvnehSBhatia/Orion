// Sends the code changes since the last sync to POST /api/ingest/code.
// Paths that .gitignore marks with "+." never leave this machine, and their
// names are never printed, so CI logs cannot leak them either.
//
// Usage: npm run ctx:sync [-- --dry-run]
// Env:   BACKEND_URL (default http://localhost:3001), ORION_ORG_ID (default demo),
//        ORION_USER_ID (optional; otherwise the backend matches the commit author), CTX_BASE_SHA (set by CI)

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCards, type FeatureCard } from './cards.ts';
import * as g from './git.ts';
import { loadPathFilter } from './privacy.ts';

const MAX_FILES = 30;
const MAX_DIFF_CHARS = 4000;
const TIMEOUT_MS = 60_000; // the backend reads the change with a model, which takes 10 to 20 seconds
const LAST_SHA_FILE = '.ctx-last-sha';
const CARDS_FILE = '.ctx-cards.json';

type IngestBody = {
  orgId?: string;
  repo: string;
  commitSha: string;
  files: { path: string; diff: string }[];
  cards?: FeatureCard[];
  userId?: string;
  author: { name: string; email: string };
};

function truncate(diff: string): string {
  if (diff.length <= MAX_DIFF_CHARS) return diff;
  return diff.slice(0, MAX_DIFF_CHARS) + `\n[diff truncated, ${diff.length - MAX_DIFF_CHARS} more chars]`;
}

function pickBase(root: string): string {
  const candidates = [
    process.env.CTX_BASE_SHA?.trim(),
    existsSync(join(root, LAST_SHA_FILE)) ? readFileSync(join(root, LAST_SHA_FILE), 'utf8').trim() : undefined,
  ];
  for (const sha of candidates) {
    if (sha && g.commitExists(root, sha)) return sha;
  }
  return g.parentOrEmpty(root);
}

function readCards(root: string, filter: ReturnType<typeof loadPathFilter>): FeatureCard[] {
  const file = join(root, CARDS_FILE);
  if (!existsSync(file)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.warn(`Could not read ${CARDS_FILE}: ${(err as Error).message}. Sending diffs only.`);
    return [];
  }
  const { cards, dropped } = parseCards(raw, filter);
  for (const d of dropped) console.warn(`Skipped card ${d.index}: ${d.reason}`);
  return cards;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const backend = (process.env.BACKEND_URL || 'http://localhost:3001').replace(/\/+$/, '');
  // ORION_TOKEN (an API token from POST /api/auth/tokens) is sent as a bearer; the org then comes from it.
  const token = process.env.ORION_TOKEN?.trim() || undefined;
  const orgId = process.env.ORION_ORG_ID?.trim() || (token ? undefined : 'demo');
  const userId = process.env.ORION_USER_ID?.trim() || undefined;

  const root = g.repoRoot();
  const filter = loadPathFilter(root);
  const head = g.headSha(root);
  const base = pickBase(root);

  const changed = g.changedFiles(root, base, head);
  const allowed = changed.filter((p) => filter.isAllowed(p));
  const privateCount = changed.filter((p) => filter.isPrivate(p)).length;
  const otherSkipped = changed.length - allowed.length - privateCount;
  const cards = readCards(root, filter);

  console.log(`Range ${base.slice(0, 7)}..${head.slice(0, 7)}: ${changed.length} changed files`);
  console.log(`  allowed ${allowed.length}, agent private ${privateCount}, other excluded ${otherSkipped}`);
  if (allowed.length > MAX_FILES) console.log(`  sending the first ${MAX_FILES}`);
  if (cards.length) console.log(`  ${cards.length} feature card(s) from ${CARDS_FILE}`);

  if (allowed.length === 0 && cards.length === 0) {
    console.log('Nothing to sync.');
    if (!dryRun) writeFileSync(join(root, LAST_SHA_FILE), head + '\n');
    return;
  }

  const body: IngestBody = {
    orgId,
    repo: g.repoName(root),
    commitSha: head,
    files: allowed.slice(0, MAX_FILES).map((path) => ({ path, diff: truncate(g.fileDiff(root, base, head, path)) })),
    author: g.headAuthor(root),
  };
  if (cards.length) body.cards = cards;
  if (userId) body.userId = userId;

  if (dryRun) {
    console.log('\nDry run. Would POST to ' + `${backend}/api/ingest/code:`);
    console.log(`  org: ${orgId ?? '(from token)'}  repo: ${body.repo}  commitSha: ${body.commitSha.slice(0, 7)}  author: ${userId ?? body.author.name}`);
    for (const f of body.files) console.log(`  file  ${f.path}  (${f.diff.length} chars of diff)`);
    for (const c of cards) console.log(`  card  ${c.label}  [${c.status}]`);
    return;
  }

  let res: Response;
  try {
    res = await fetch(`${backend}/api/ingest/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    console.error(`Could not reach ${backend}: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const text = await res.text();
  if (!res.ok) {
    console.error(`Backend returned ${res.status}: ${text.slice(0, 500)}`);
    process.exitCode = 1;
    return;
  }

  let touched: string[] = [];
  try {
    touched = JSON.parse(text).nodesTouched ?? [];
  } catch {
    // backend replied with something other than JSON; the sync still landed
  }
  writeFileSync(join(root, LAST_SHA_FILE), head + '\n');
  if (existsSync(join(root, CARDS_FILE))) unlinkSync(join(root, CARDS_FILE));
  console.log(`Synced. Updated ${touched.length} item(s)${touched.length ? ': ' + touched.join(', ') : ''}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
