// Stand-in for Team C's backend. Accepts POST /api/ingest/code with the shape
// from spec section 1.3 (plus the optional `cards` field), checks it, and
// saves the last payload to mock/out/ so you can see exactly what was sent.

import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';

const PORT = Number(process.env.PORT ?? 3001);
const OUT = new URL('./out/', import.meta.url);
const MAX_BODY_BYTES = 5_000_000;
const STATUSES = ['shipped', 'in_beta', 'in_progress'];

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) reject(new Error('body too large'));
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'change';

function featureFolder(path) {
  const parts = path.split('/');
  const i = parts.indexOf('features');
  if (i >= 0 && parts[i + 1]) return parts[i + 1];
  return parts.length > 1 ? parts[parts.length - 2] : parts[0].replace(/\.[^.]+$/, '');
}

createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/api/ingest/code') {
    return json(res, 404, { error: 'not found' });
  }

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    return json(res, 400, { error: String(err) });
  }

  const { repo, commitSha, files, cards } = body;
  const problems = [];
  if (typeof repo !== 'string' || !repo) problems.push('repo missing');
  if (typeof commitSha !== 'string' || !commitSha) problems.push('commitSha missing');
  if (!Array.isArray(files)) problems.push('files missing');
  else {
    if (files.length > 30) problems.push(`${files.length} files, limit 30`);
    files.forEach((f, i) => {
      if (typeof f?.path !== 'string') problems.push(`files[${i}].path missing`);
      if (typeof f?.diff !== 'string') problems.push(`files[${i}].diff missing`);
      else if (f.diff.length > 4100) problems.push(`files[${i}].diff is ${f.diff.length} chars`);
    });
  }
  if (cards !== undefined) {
    if (!Array.isArray(cards)) problems.push('cards must be an array');
    else
      cards.forEach((c, i) => {
        if (typeof c?.label !== 'string' || c.label.length > 40) problems.push(`cards[${i}].label bad`);
        if (typeof c?.summary !== 'string' || c.summary.length > 140) problems.push(`cards[${i}].summary bad`);
        if (!STATUSES.includes(c?.status)) problems.push(`cards[${i}].status bad`);
      });
  }
  if (problems.length) {
    console.log('rejected:', problems.join('; '));
    return json(res, 400, { error: problems.join('; ') });
  }

  await mkdir(OUT, { recursive: true });
  await writeFile(new URL('last-code.json', OUT), JSON.stringify(body, null, 2));

  const touched = cards?.length
    ? cards.map((c) => slug(c.label))
    : [...new Set(files.map((f) => slug(featureFolder(f.path))))];

  console.log(`${new Date().toLocaleTimeString()}  ${repo}  ${commitSha.slice(0, 7)}`);
  for (const f of files) console.log(`  file  ${f.path}  (${f.diff.length} chars)`);
  for (const c of cards ?? []) console.log(`  card  ${c.label}  [${c.status}]`);

  return json(res, 200, { nodesTouched: touched });
}).listen(PORT, () => {
  console.log(`Mock code ingest on http://localhost:${PORT}  (payloads saved to mock/out/)`);
});
