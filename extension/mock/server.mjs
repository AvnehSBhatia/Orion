// A local stand-in for POST /api/ingest/capture, for seeing exactly what the
// extension sends without running the Orion server. It checks the same size
// limits as the server and saves the last capture to mock/out/ (screenshot,
// HTML, and the JSON body). It ignores auth and answers with a made-up node id.

import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';

const PORT = Number(process.env.PORT ?? 3001);
const OUT = new URL('./out/', import.meta.url);
const MAX_BODY_BYTES = 10_000_000;

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

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'page';

createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  if (req.method !== 'POST' || req.url !== '/api/ingest/capture') {
    return json(res, 404, { error: 'not found' });
  }

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    return json(res, 400, { error: String(err) });
  }

  const { userId, url, title, html, screenshotB64, redactions = [], source = 'tab' } = body;
  const problems = [];
  if (typeof userId !== 'string' || !userId) problems.push('userId missing');
  if (typeof url !== 'string' || !url) problems.push('url missing');
  if (typeof html !== 'string') problems.push('html missing');
  else if (html.length > 60_000) problems.push(`html is ${html.length} chars, limit 60000`);
  if (typeof screenshotB64 !== 'string' || !screenshotB64) problems.push('screenshotB64 missing');
  else if (screenshotB64.length > 2_000_000) problems.push(`screenshot is ${screenshotB64.length} chars, limit 2MB`);
  if (problems.length) {
    console.log('rejected:', problems.join('; '));
    return json(res, 400, { error: problems.join('; ') });
  }

  await mkdir(OUT, { recursive: true });
  await writeFile(new URL('last-capture.jpg', OUT), Buffer.from(screenshotB64, 'base64'));
  await writeFile(new URL('last-capture.html', OUT), html);
  await writeFile(
    new URL('last-capture.json', OUT),
    JSON.stringify({ ...body, html: `<${html.length} chars>`, screenshotB64: `<${screenshotB64.length} chars>` }, null, 2),
  );

  console.log(
    `${new Date().toLocaleTimeString()}  ${userId}  [${source}]  ${url}\n` +
      `  title: ${title}\n  html: ${html.length} chars  screenshot: ${Math.round(screenshotB64.length / 1024)} KB b64  redactions: ${redactions.length}`,
  );

  return json(res, 200, { nodesTouched: [slug(title ?? url)] });
}).listen(PORT, () => {
  console.log(`Mock backend on http://localhost:${PORT}  (captures saved to mock/out/)`);
});
