// Local stand-in for the Constellation backend, so the Mac app can be tested
// before the real one exists. Plain Node, no packages. Shapes follow
// mac/BACKEND_CONTRACT.md.
//
//   node mac/mock-backend/server.mjs          (port 8787, or PORT=...)
//
// Everything received is saved under mac/mock-backend/data/ (git ignored) so
// you can look at exactly what arrived.

import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const PORT = Number(process.env.PORT ?? 8787);
// MOCK_DATA_DIR lets tests use their own folder instead of mock-backend/data/.
const DATA = process.env.MOCK_DATA_DIR
  ? pathToFileURL(process.env.MOCK_DATA_DIR.replace(/\/?$/, '/'))
  : new URL('./data/', import.meta.url);
const DEVICES_FILE = new URL('devices.json', DATA);
const BLOCKS_FILE = new URL('work-blocks.jsonl', DATA);
const CLIENTS_FILE = new URL('./clients.json', import.meta.url); // edit it to try your own clients
const MAX_BODY = 5_000_000;

const BLOCK_FIELDS = {
  id: 'string', started_at: 'string', ended_at: 'string', app_bundle_id: 'string', app_name: 'string',
  window_title: 'string', text: 'string', redaction_count: 'number',
};
const OPTIONAL_FIELDS = { domain_path: 'string', client_id: 'string' };

// Things that should never arrive, because the app redacts them first.
const LEAKS = [
  ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/],
  ['phone', /\(?\b\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/],
  ['api key', /\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})/],
];

let devices = new Map(); // token -> device
const blocks = new Map(); // block id -> { device_id, block }

async function load() {
  await mkdir(DATA, { recursive: true });
  try {
    for (const device of JSON.parse(await readFile(DEVICES_FILE, 'utf8'))) devices.set(device.token, device);
  } catch { /* first run */ }
}

const saveDevices = () => writeFile(DEVICES_FILE, JSON.stringify([...devices.values()], null, 2));

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try { resolve(text ? JSON.parse(text) : {}); } catch { reject(new Error('body is not JSON')); }
    });
    req.on('error', reject);
  });
}

function deviceFor(req) {
  const match = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
  return match ? devices.get(match[1]) : undefined;
}

function checkBlock(block) {
  if (typeof block !== 'object' || block === null) return 'not an object';
  for (const [key, type] of Object.entries(BLOCK_FIELDS)) {
    if (typeof block[key] !== type) return `${key} missing or not a ${type}`;
  }
  for (const [key, type] of Object.entries(OPTIONAL_FIELDS)) {
    if (block[key] != null && typeof block[key] !== type) return `${key} is not a ${type}`;
  }
  const extra = Object.keys(block).filter((key) => !(key in BLOCK_FIELDS) && !(key in OPTIONAL_FIELDS));
  if (extra.length) return `unexpected fields: ${extra.join(', ')}`;
  return null;
}

const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

async function handle(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const route = `${req.method} ${url.pathname}`;

  if (route === 'POST /v1/devices/register') {
    const body = await readBody(req);
    if (typeof body.install_id !== 'string' || !body.install_id) return send(res, 400, { error: 'install_id is required' });
    const device = {
      device_id: `dev_${randomUUID().slice(0, 8)}`,
      token: randomBytes(24).toString('hex'),
      install_id: body.install_id,
      platform: body.platform, os_version: body.os_version, app_version: body.app_version,
      enrollment_code: body.enrollment_code ?? null,
      registered_at: new Date().toISOString(),
    };
    devices.set(device.token, device);
    await saveDevices();
    console.log(`registered ${device.device_id} (${device.platform}, app ${device.app_version})`);
    return send(res, 200, { device_id: device.device_id, token: device.token });
  }

  if (route === 'POST /v1/work-blocks') {
    const device = deviceFor(req);
    if (!device) return send(res, 401, { error: 'unknown or missing device token' });
    const body = await readBody(req);
    if (!Array.isArray(body.blocks)) return send(res, 400, { error: 'blocks must be an array' });
    if (body.device_id !== device.device_id) return send(res, 400, { error: 'device_id does not match the token' });

    const accepted = [];
    const rejected = [];
    for (const block of body.blocks) {
      const problem = checkBlock(block);
      if (problem) { rejected.push({ id: String(block?.id ?? ''), reason: problem }); continue; }
      const repeat = blocks.has(block.id);
      blocks.set(block.id, { device_id: device.device_id, block }); // same id again replaces: safe to resend
      if (!repeat) await appendFile(BLOCKS_FILE, JSON.stringify({ device_id: device.device_id, ...block }) + '\n');
      accepted.push(block.id);
      const leaks = LEAKS.filter(([, pattern]) => pattern.test(`${block.window_title} ${block.text}`)).map(([name]) => name);
      console.log(
        `  ${repeat ? '(again) ' : ''}${block.app_name} ${time(block.started_at)}-${time(block.ended_at)}: ` +
        `${block.text.length} chars, ${block.redaction_count} redactions` +
        (block.domain_path ? `, ${block.domain_path.split('/')[0]}` : '') +
        (block.client_id ? `, client ${block.client_id}` : '') +
        (leaks.length ? `  NOTE: contains what looks like a${leaks.length === 1 ? 'n' : ''} ${leaks.join(', ')} (expected only if that redaction was turned off; an api key should never appear)` : ''),
      );
    }
    console.log(`work blocks from ${device.device_id}: ${accepted.length} accepted, ${rejected.length} rejected`);
    return send(res, 200, { accepted, rejected });
  }

  if (route === 'GET /v1/clients') {
    const device = deviceFor(req);
    if (!device) return send(res, 401, { error: 'unknown or missing device token' });
    // Read fresh every time, so edits to clients.json show up on the next sync.
    // The mock ignores ?since= and returns the whole list; mark a client
    // "deleted": true to remove it from devices.
    const clients = JSON.parse(await readFile(CLIENTS_FILE, 'utf8'));
    console.log(`clients for ${device.device_id}: ${clients.length} (since ${url.searchParams.get('since') ?? 'the start'})`);
    return send(res, 200, { clients, next_since: new Date().toISOString() });
  }

  if (route === 'DELETE /v1/me/data') {
    const device = deviceFor(req);
    if (!device) return send(res, 401, { error: 'unknown or missing device token' });
    let removed = 0;
    for (const [id, entry] of blocks) if (entry.device_id === device.device_id) { blocks.delete(id); removed += 1; }
    console.log(`deleted ${removed} blocks for ${device.device_id}`);
    res.writeHead(204);
    return res.end();
  }

  // The rest of the contract arrives with the daily draft.
  if (['GET /v1/drafts/today', 'POST /v1/baseline'].includes(route) ||
      /^POST \/v1\/drafts\/entries\/[^/]+\/review$/.test(route)) {
    return send(res, 501, { error: 'not in the mock yet' });
  }
  return send(res, 404, { error: 'not found' });
}

await load();
createServer((req, res) => {
  handle(req, res).catch((error) => send(res, 400, { error: String(error.message ?? error) }));
}).listen(PORT, () => {
  console.log(`Constellation mock backend on http://localhost:${PORT} (${devices.size} known devices). Data in ${DATA.pathname}`);
});
