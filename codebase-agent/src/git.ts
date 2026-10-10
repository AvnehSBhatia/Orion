import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';

// git's well-known empty tree, used as the base when HEAD has no parent.
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export function git(args: string[], cwd: string): string {
  return execFileSync('git', ['-c', 'core.quotepath=off', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function repoRoot(cwd = process.cwd()): string {
  return git(['rev-parse', '--show-toplevel'], cwd).trim();
}

export function headSha(root: string): string {
  return git(['rev-parse', 'HEAD'], root).trim();
}

export function commitExists(root: string, sha: string): boolean {
  if (!/^[0-9a-f]{7,40}$/i.test(sha) || /^0+$/.test(sha)) return false;
  try {
    git(['cat-file', '-e', `${sha}^{commit}`], root);
    return true;
  } catch {
    return false;
  }
}

export function parentOrEmpty(root: string): string {
  try {
    return git(['rev-parse', 'HEAD~1'], root).trim();
  } catch {
    return EMPTY_TREE;
  }
}

export function changedFiles(root: string, base: string, head: string): string[] {
  return git(['diff', '--name-only', '--no-renames', base, head], root)
    .split(/\r?\n/)
    .filter(Boolean);
}

export function fileDiff(root: string, base: string, head: string, path: string): string {
  return git(['diff', '--no-color', '--no-renames', base, head, '--', path], root);
}

export function headAuthor(root: string): { name: string; email: string } {
  const [name = '', email = ''] = git(['log', '-1', '--format=%an%x00%ae', 'HEAD'], root).trim().split('\0');
  return { name, email };
}

export function repoName(root: string): string {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  try {
    const url = git(['remote', 'get-url', 'origin'], root).trim();
    const m = url.match(/[:/]([^/:]+\/[^/]+?)(\.git)?$/);
    if (m) return m[1];
  } catch {
    // no origin remote
  }
  return basename(root);
}
