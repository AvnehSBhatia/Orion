// Builds the Chrome Web Store upload: a production build of dist/ zipped into
// release/orion-extension-<version>.zip.
//
//   ORION_SERVER_URL=https://orion.example.com npm run package
//
// Fails without ORION_SERVER_URL, or when it is not https.

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts });

if (!process.env.ORION_SERVER_URL?.trim()) {
  console.error('ORION_SERVER_URL is required, for example:\n  ORION_SERVER_URL=https://orion.example.com npm run package');
  process.exit(1);
}
if (!/^https:\/\/[^/]/.test(process.env.ORION_SERVER_URL.trim())) {
  console.error(`ORION_SERVER_URL must be an https:// URL for a store build: ${process.env.ORION_SERVER_URL}`);
  process.exit(1);
}

run('npm', ['run', '--silent', 'typecheck']);
run(process.execPath, ['--test', 'test/**/*.test.ts']);
run(process.execPath, ['build.mjs', '--production']);

const manifest = JSON.parse(await readFile(path.join(root, 'dist/manifest.json'), 'utf8'));
const out = path.join(root, 'release', `orion-extension-${manifest.version}.zip`);
await mkdir(path.dirname(out), { recursive: true });
await rm(out, { force: true });
// -X drops extra file attributes; -D leaves out directory entries. Source maps are never built.
run('zip', ['-r', '-X', '-D', '-q', out, '.', '-x', '.DS_Store', '-x', '*/.DS_Store', '-x', 'icons/icon.svg'], {
  cwd: path.join(root, 'dist'),
});
console.log(`\n[orion] ${path.relative(root, out)} (version ${manifest.version}, server ${process.env.ORION_SERVER_URL})`);
console.log(`[orion] host_permissions: ${manifest.host_permissions.join(', ')}`);
