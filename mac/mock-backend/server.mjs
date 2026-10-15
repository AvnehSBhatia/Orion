// Local stand-in for the Constellation backend, so the Mac app can be tested
// before the real one exists. Plain Node, no packages. Shapes follow
// mac/BACKEND_CONTRACT.md.
//
//   node mac/mock-backend/server.mjs          (port 8787, or PORT=...)
//   ANTHROPIC_API_KEY=... node mac/mock-backend/server.mjs
//                                             (Outbox summaries written by Claude)
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
const REVIEWS_FILE = new URL('reviews.json', DATA);
const MAX_BODY = 5_000_000;
// Outbox summaries: Claude when a key is set, otherwise a plain list of titles.
const AI_KEY = process.env.ANTHROPIC_API_KEY;
const AI_MODEL = process.env.CLAUDE_MODEL ?? 'claude-opus-5-5';
const AI_URL = process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com';

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
const reviews = new Map(); // draft entry id -> { status, description?, minutes?, client_id? (null = no client) }

async function load() {
  await mkdir(DATA, { recursive: true });
  try {
    for (const device of JSON.parse(await readFile(DEVICES_FILE, 'utf8'))) devices.set(device.token, device);
  } catch { /* first run */ }
  try {
    for (const line of (await readFile(BLOCKS_FILE, 'utf8')).split('\n').filter(Boolean)) {
      const { device_id, ...block } = JSON.parse(line);
      blocks.set(block.id, { device_id, block });
    }
  } catch { /* none yet */ }
  try {
    for (const [id, review] of Object.entries(JSON.parse(await readFile(REVIEWS_FILE, 'utf8')))) reviews.set(id, review);
  } catch { /* none yet */ }
}

const saveReviews = () => writeFile(REVIEWS_FILE, JSON.stringify(Object.fromEntries(reviews), null, 2));

// The day "2026-10-13" of an ISO time, in the person's time zone.
function localDay(iso, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

// A stand-in for the real backend's AI drafting: one entry per client for the day,
// minutes from the blocks' spans, and a description listing what was worked on.
function draftFor(device, tz) {
  const today = localDay(new Date().toISOString(), tz);
  const groups = new Map();
  for (const { device_id, block } of blocks.values()) {
    if (device_id !== device.device_id || localDay(block.started_at, tz) !== today) continue;
    const key = block.client_id ?? 'none';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(block);
  }
  const entries = [...groups].map(([key, list]) => {
    list.sort((a, b) => a.started_at.localeCompare(b.started_at));
    const seconds = list.reduce((sum, b) => sum + Math.max(0, (new Date(b.ended_at) - new Date(b.started_at)) / 1000), 0);
    const titles = [...new Set(list.map((b) => b.window_title).filter(Boolean))];
    const apps = [...new Set(list.map((b) => b.app_name))].join(', ');
    const id = `d_${today}_${key}`;
    const entry = {
      id,
      client_id: key === 'none' ? null : key,
      description: `${apps}: ${titles.slice(0, 3).join('; ')}${titles.length > 3 ? ` and ${titles.length - 3} more` : ''}`.slice(0, 500),
      minutes: Math.max(1, Math.ceil(seconds / 60)),
      started_at: list[0].started_at,
      ended_at: list[list.length - 1].ended_at,
      block_ids: list.map((b) => b.id),
      status: 'pending',
      edited: false,
    };
    const review = reviews.get(id);
    if (review) {
      entry.status = review.status;
      if (review.description !== undefined) { entry.description = review.description; entry.edited = true; }
      if (review.minutes !== undefined) { entry.minutes = review.minutes; entry.edited = true; }
      if (review.client_id !== undefined) { entry.client_id = review.client_id; entry.edited = true; }
    }
    return entry;
  });
  return { date: today, entries };
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

const SUMMARY_PROMPT = `You summarize a stretch of someone's computer work so they can check it before it is saved.
You get the work blocks from that stretch: times, app, window title (for email, "Subject — Sender"), web address, and the text that was on screen.
Write 1 to 3 short sentences in the second person and past tense ("You replied to...", "You reviewed..."): what they actually did, with the specific subjects, clients, documents, and sites.
Use only what is in the blocks. Do not guess at intent or add filler. Reading an email is "You read", not "You replied", unless the text shows a reply.
Keep markers like [EMAIL], [PHONE], [ADDRESS], [Person 1] exactly as written and never guess what they hide.
Under 350 characters. Reply with the summary only.`;

const clip = (text, max) => (text.length > max ? `${text.slice(0, max)}…` : text);

// One stretch of work as plain text for the model, capped so a long batch stays small.
function blocksForAI(list) {
  return list.slice(0, 40).map((block, index) => [
    `Block ${index + 1}: ${time(block.started_at)}–${time(block.ended_at)}, ${block.app_name}`,
    `Title: ${block.window_title || '(none)'}`,
    block.domain_path ? `Address: ${block.domain_path}` : null,
    block.text ? `Text:\n${clip(block.text, 1500)}` : null,
  ].filter(Boolean).join('\n')).join('\n\n');
}

// Claude's summary. Nothing is saved; errors say only the status.
async function aiSummary(list) {
  const response = await fetch(`${AI_URL}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': AI_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 300,
      system: SUMMARY_PROMPT,
      messages: [{ role: 'user', content: blocksForAI(list) }],
    }),
    signal: AbortSignal.timeout(15_000), // the app gives up at 20 s
  });
  if (!response.ok) throw new Error(`the AI service answered ${response.status}`);
  const data = await response.json();
  const text = (data.content ?? []).filter((part) => part.type === 'text').map((part) => part.text).join('').trim();
  if (!text) throw new Error('the AI service returned no text');
  return text;
}

// "Read “Subject” from Sender. Viewed “Pricing” on initech.com." One phrase per
// distinct thing, in order. Used when no AI key is set.
function mockSummary(list) {
  const phrases = [];
  for (const block of list) {
    const title = block.window_title || block.app_name;
    let phrase;
    if (block.app_bundle_id === 'com.apple.mail') {
      const cut = title.lastIndexOf(' — ');
      phrase = cut > 0 ? `Read “${title.slice(0, cut)}” from ${title.slice(cut + 3)}` : `Read “${title}” in Mail`;
    } else if (block.domain_path) {
      phrase = `Viewed “${title}” on ${block.domain_path.split('/')[0]}`;
    } else {
      phrase = `Worked in ${block.app_name} on “${title}”`;
    }
    if (!phrases.includes(phrase)) phrases.push(phrase);
  }
  const shown = phrases.slice(0, 4).join('. ');
  const more = phrases.length > 4 ? ` And ${phrases.length - 4} more.` : '.';
  return `${shown}${more} (Not an AI summary: start the mock with ANTHROPIC_API_KEY set for one.)`;
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

  if (route === 'POST /v1/summaries') {
    // Summarize a batch still waiting in the Outbox. Nothing here is saved or
    // logged except counts: the blocks are not approved yet. The real backend's
    // AI writes this text; the mock just lists what was worked on.
    const device = deviceFor(req);
    if (!device) return send(res, 401, { error: 'unknown or missing device token' });
    const body = await readBody(req);
    if (!Array.isArray(body.blocks) || body.blocks.length === 0) return send(res, 400, { error: 'blocks must be a non-empty array' });
    if (body.device_id !== device.device_id) return send(res, 400, { error: 'device_id does not match the token' });
    for (const block of body.blocks) {
      const problem = checkBlock(block);
      if (problem) return send(res, 400, { error: `block ${block?.id ?? ''}: ${problem}` });
    }
    if (!AI_KEY) {
      console.log(`summary for ${device.device_id}: ${body.blocks.length} blocks, plain list (no ANTHROPIC_API_KEY), not stored`);
      return send(res, 200, { summary: mockSummary(body.blocks) });
    }
    try {
      const summary = await aiSummary(body.blocks);
      console.log(`summary for ${device.device_id}: ${body.blocks.length} blocks, written by ${AI_MODEL}, not stored`);
      return send(res, 200, { summary });
    } catch (error) {
      console.log(`summary for ${device.device_id}: failed (${error.message})`);
      return send(res, 502, { error: `Couldn't reach the AI: ${error.message}` });
    }
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

  if (route === 'GET /v1/drafts/today') {
    const device = deviceFor(req);
    if (!device) return send(res, 401, { error: 'unknown or missing device token' });
    const tz = url.searchParams.get('tz') || 'UTC';
    try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { return send(res, 400, { error: `unknown time zone ${tz}` }); }
    const draft = draftFor(device, tz);
    console.log(`draft for ${device.device_id}: ${draft.date}, ${draft.entries.length} entries`);
    return send(res, 200, draft);
  }

  const reviewRoute = /^POST \/v1\/drafts\/entries\/([^/]+)\/review$/.exec(route);
  if (reviewRoute) {
    const device = deviceFor(req);
    if (!device) return send(res, 401, { error: 'unknown or missing device token' });
    const id = decodeURIComponent(reviewRoute[1]);
    const body = await readBody(req);
    const status = { accept: 'accepted', reject: 'rejected', edit: undefined }[body.action];
    if (!['accept', 'reject', 'edit'].includes(body.action)) return send(res, 400, { error: 'action must be accept, reject, or edit' });
    if (body.minutes !== undefined && !(Number.isInteger(body.minutes) && body.minutes >= 1 && body.minutes <= 1440)) {
      return send(res, 400, { error: 'minutes must be 1 to 1440' });
    }
    const previous = reviews.get(id) ?? { status: 'pending' };
    const review = { ...previous, status: status ?? previous.status };
    if (body.description !== undefined) review.description = String(body.description).slice(0, 500);
    if (body.minutes !== undefined) review.minutes = body.minutes;
    if ('client_id' in body) review.client_id = body.client_id; // null means no client
    reviews.set(id, review);
    await saveReviews();
    const entry = draftFor(device, url.searchParams.get('tz') || Intl.DateTimeFormat().resolvedOptions().timeZone)
      .entries.find((e) => e.id === id);
    if (!entry) return send(res, 404, { error: 'no such entry today' });
    console.log(`review ${id}: ${body.action}${review.client_id !== undefined ? `, client ${review.client_id ?? 'none'}` : ''}`);
    return send(res, 200, entry);
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

  if (route === 'POST /v1/baseline') return send(res, 501, { error: 'not in the mock yet' });
  return send(res, 404, { error: 'not found' });
}

await load();
createServer((req, res) => {
  handle(req, res).catch((error) => send(res, 400, { error: String(error.message ?? error) }));
}).listen(PORT, () => {
  console.log(`Constellation mock backend on http://localhost:${PORT} (${devices.size} known devices). Data in ${DATA.pathname}`);
  console.log(AI_KEY ? `Outbox summaries: written by ${AI_MODEL}.` : 'Outbox summaries: plain lists. Set ANTHROPIC_API_KEY for AI summaries.');
});
