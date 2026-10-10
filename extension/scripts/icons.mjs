// Renders the Orion mark to the toolbar and store PNGs in static/icons/.
// Run from the extension folder: npm run icons (uses sharp from the repo root).
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { logoSvg } from '../src/logo.ts';

const out = new URL('../static/icons/', import.meta.url);
await mkdir(out, { recursive: true });

for (const live of [false, true]) {
  for (const size of [16, 32, 48, 128]) {
    const svg = logoSvg({ small: size <= 32, live });
    const png = await sharp(Buffer.from(svg), { density: Math.max(72, (72 * size) / 128 * 4) })
      .resize(size, size)
      .png()
      .toBuffer();
    await writeFile(new URL(`orion${live ? '-live' : ''}-${size}.png`, out), png);
  }
}
await writeFile(new URL('logo.svg', out), logoSvg());
console.log('wrote static/icons/orion-{16,32,48,128}.png, the -live set, and logo.svg');
