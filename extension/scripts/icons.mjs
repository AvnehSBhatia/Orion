// Renders the extension icons from SVG into static/icons/ with sharp:
//   icon-{16,32,48,128}.png    the Orion mark (manifest, idle toolbar icon)
//   active-{16,32,48,128}.png  the mark with a red recording dot (toolbar icon while capturing)
//   store/promo-440x280.png    small promo tile for the Chrome Web Store
//
// The PNGs are committed, so a normal build does not need sharp. To redraw them:
//   SHARP_PATH=/path/to/node_modules/sharp npm run icons
// (defaults to ../server/node_modules/sharp, the server's copy).

import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);

function loadSharp() {
  const candidates = [process.env.SHARP_PATH, 'sharp', path.join(root, '../server/node_modules/sharp')].filter(Boolean);
  for (const c of candidates) {
    try {
      return require(c);
    } catch {
      // try the next one
    }
  }
  console.error('sharp not found. Set SHARP_PATH to a node_modules/sharp directory (the server has one).');
  process.exit(1);
}
const sharp = loadSharp();

const BG = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1B2748"/>
      <stop offset="1" stop-color="#0B1020"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.3" cy="0.25" r="0.7">
      <stop offset="0" stop-color="#6EA8FF" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#6EA8FF" stop-opacity="0"/>
    </radialGradient>
  </defs>`;

// Detailed mark for 48px and up: the five-star constellation used in the UI.
function detailed(active) {
  const s = (x) => 14 + x * 2.5; // the UI logo's 40-unit grid, inset into 128
  const pts = { a: [6, 29], b: [15, 14], c: [26, 19], d: [34, 7], e: [31, 33] };
  const P = Object.fromEntries(Object.entries(pts).map(([k, [x, y]]) => [k, [s(x), s(y)]]));
  const line = (p, q) => `<line x1="${P[p][0]}" y1="${P[p][1]}" x2="${P[q][0]}" y2="${P[q][1]}"/>`;
  const star = (p, r, fill) => `<circle cx="${P[p][0]}" cy="${P[p][1]}" r="${r}" fill="${fill}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">${BG}
    <rect x="4" y="4" width="120" height="120" rx="28" fill="url(#bg)"/>
    <rect x="4" y="4" width="120" height="120" rx="28" fill="url(#glow)"/>
    <g stroke="#F2F4F8" stroke-opacity="0.45" stroke-width="3.5" stroke-linecap="round">
      ${line('a', 'b')}${line('b', 'c')}${line('c', 'd')}${line('c', 'e')}
    </g>
    ${star('a', 7, '#E3C26B')}${star('b', 8, '#6EA8FF')}${star('c', 10, '#F2F4F8')}${star('d', 7, '#5EEAD4')}${star('e', 7, '#FF9F6E')}
    ${active ? recDot(128) : ''}
  </svg>`;
}

// Simplified mark for 16 and 32px: three bold stars on one line, so it stays crisp.
function simple(active) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${BG}
    <rect x="0.5" y="0.5" width="31" height="31" rx="7" fill="url(#bg)"/>
    <line x1="7.5" y1="23" x2="24.5" y2="9" stroke="#F2F4F8" stroke-opacity="0.5" stroke-width="2" stroke-linecap="round"/>
    <circle cx="7.5" cy="23" r="3.6" fill="#E3C26B"/>
    <circle cx="16" cy="16" r="4.4" fill="#F2F4F8"/>
    <circle cx="24.5" cy="9" r="3.6" fill="#6EA8FF"/>
    ${active ? recDot(32) : ''}
  </svg>`;
}

// Red "recording" dot in the bottom-right corner, ringed so it reads on any toolbar.
function recDot(size) {
  const r = size * 0.17;
  const c = size - r - size * 0.02;
  return `<circle cx="${c}" cy="${c}" r="${r + size * 0.05}" fill="#0B1020"/><circle cx="${c}" cy="${c}" r="${r}" fill="#FF5C7A"/>`;
}

function promo() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 280">
    <defs>
      <linearGradient id="p" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#17203A"/><stop offset="1" stop-color="#0B1020"/>
      </linearGradient>
    </defs>
    <rect width="440" height="280" fill="url(#p)"/>
    <g transform="translate(40 76) scale(1)">${detailed(false).replace(/^<svg[^>]*>/, '<svg x="0" y="0" width="128" height="128" viewBox="0 0 128 128">')}</g>
    <text x="196" y="132" font-family="Inter, Helvetica, Arial, sans-serif" font-size="48" font-weight="700" fill="#F2F4F8">Orion</text>
    <text x="198" y="170" font-family="Inter, Helvetica, Arial, sans-serif" font-size="18" fill="#A8B0C4">Your work, on the team map</text>
  </svg>`;
}

const outDir = path.join(root, 'static/icons');
await mkdir(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  for (const active of [false, true]) {
    const svg = size <= 32 ? simple(active) : detailed(active);
    const file = path.join(outDir, `${active ? 'active' : 'icon'}-${size}.png`);
    await sharp(Buffer.from(svg), { density: 72 * Math.max(1, size / 32) }).resize(size, size).png().toFile(file);
    console.log('wrote', path.relative(root, file));
  }
}
await mkdir(path.join(root, 'store'), { recursive: true });
await sharp(Buffer.from(promo())).resize(440, 280).png().toFile(path.join(root, 'store/promo-440x280.png'));
await writeFile(path.join(outDir, 'icon.svg'), detailed(false));
console.log('wrote store/promo-440x280.png, static/icons/icon.svg');
