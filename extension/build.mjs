// Builds the extension into dist/.
//
//   node build.mjs                 dev build, server defaults to http://localhost:3001
//   node build.mjs --watch         same, rebuilding on change
//   node build.mjs --production    store build: ORION_SERVER_URL (https) is required, output is minified
//
// ORION_SERVER_URL sets the default server baked into the build and the only
// host the extension can reach without asking (host_permissions). Tabs are
// reached through optional_host_permissions, which the chooser asks for the
// first time someone shares a tab.

import * as esbuild from 'esbuild';
import { cp, readFile, rm, writeFile } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');
const DEV_SERVER_URL = 'http://localhost:3001';

/** Same rule as src/lib/url.ts isAllowedServerUrl, plus https-only for store builds. */
function checkServerUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return `ORION_SERVER_URL is not a URL: ${raw}`;
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol === 'https:') return null;
  if (url.protocol === 'http:' && local && !production) return null;
  return `ORION_SERVER_URL must be https://${production ? '' : ' (or http://localhost)'}: ${raw}`;
}

const serverUrl = (process.env.ORION_SERVER_URL ?? '').trim().replace(/\/+$/, '') || (production ? '' : DEV_SERVER_URL);
if (!serverUrl) {
  console.error('ORION_SERVER_URL is required for a production build, for example:\n  ORION_SERVER_URL=https://orion.example.com npm run package');
  process.exit(1);
}
const problem = checkServerUrl(serverUrl);
if (problem) {
  console.error(problem);
  process.exit(1);
}

function hostPermissions() {
  const url = new URL(serverUrl);
  const own = `${url.protocol}//${url.hostname}/*`;
  const local = production ? [] : ['http://localhost/*', 'http://127.0.0.1/*'];
  return [...new Set([own, ...local])];
}

// Copies static/ and writes dist/manifest.json with this build's host permissions.
const copyStatic = {
  name: 'copy-static',
  setup(build) {
    build.onEnd(async () => {
      await cp('static', 'dist', { recursive: true });
      const manifest = JSON.parse(await readFile('static/manifest.json', 'utf8'));
      manifest.host_permissions = hostPermissions();
      if (!production) manifest.name = `${manifest.name} (dev)`;
      await writeFile('dist/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
    });
  },
};

const options = {
  entryPoints: {
    background: 'src/background.ts',
    popup: 'src/popup.ts',
    options: 'src/options.ts',
    capture: 'src/capture.ts',
    'read-page': 'src/read-page-entry.ts',
  },
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  minify: production,
  legalComments: 'none',
  logLevel: 'info',
  define: {
    __ORION_SERVER_URL__: JSON.stringify(serverUrl),
    __ORION_DEV__: JSON.stringify(!production),
  },
  plugins: [copyStatic],
};

await rm('dist', { recursive: true, force: true });
console.log(`[orion] ${production ? 'production' : 'dev'} build, server ${serverUrl}`);

if (watch) {
  await (await esbuild.context(options)).watch();
} else {
  await esbuild.build(options);
}
