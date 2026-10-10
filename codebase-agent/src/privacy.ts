import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ignore from 'ignore';

// Excluded no matter what .gitignore says. Kept in its own matcher so a
// "!.env.example" style negation in .gitignore cannot unblock these.
const ALWAYS_EXCLUDED = [
  '.env*',
  '*.pem',
  '*.key',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'node_modules/',
  '.ctx-cards.json',
  '.ctx-last-sha',
];

const PLUS_DOT = '+.';

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

function readGitignore(repoRoot: string): string {
  const file = join(repoRoot, '.gitignore');
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

export function privateGlobsFrom(gitignoreText: string): string[] {
  return splitLines(gitignoreText)
    .map((l) => l.trim())
    .filter((l) => l.startsWith(PLUS_DOT))
    .map((l) => l.slice(PLUS_DOT.length))
    .filter((g) => g.length > 0);
}

export function loadPrivatePaths(repoRoot: string): string[] {
  return privateGlobsFrom(readGitignore(repoRoot));
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

export type PathFilter = {
  privateGlobs: string[];
  isPrivate(path: string): boolean;
  isAllowed(path: string): boolean;
};

export function createPathFilter(gitignoreText: string): PathFilter {
  const lines = splitLines(gitignoreText);
  const privateGlobs = privateGlobsFrom(gitignoreText);
  const gitRules = ignore().add(lines.filter((l) => !l.trim().startsWith(PLUS_DOT)));
  const privateRules = ignore().add(privateGlobs);
  const alwaysRules = ignore().add(ALWAYS_EXCLUDED);

  const isPrivate = (path: string) => {
    const p = normalizePath(path);
    return p.length > 0 && privateRules.ignores(p);
  };

  const isAllowed = (path: string) => {
    const p = normalizePath(path);
    if (!p) return false;
    if (alwaysRules.ignores(p)) return false;
    if (gitRules.ignores(p)) return false;
    if (privateRules.ignores(p)) return false;
    return true;
  };

  return { privateGlobs, isPrivate, isAllowed };
}

export function loadPathFilter(repoRoot: string): PathFilter {
  return createPathFilter(readGitignore(repoRoot));
}
