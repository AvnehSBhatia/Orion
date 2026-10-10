// The Orion mark: the constellation's hourglass, two shoulders, the three-star belt, and two feet.
// One source for the popup (animated), the settings page, and the toolbar PNGs (scripts/icons.mjs).
// Erasable TypeScript only, so Node can import it directly when generating icons.

type Star = { id: string; x: number; y: number; r: number; color: string; belt?: boolean };

const STARS: Star[] = [
  { id: 'betelgeuse', x: 38, y: 30, r: 5.2, color: '#ffb27a' },
  { id: 'bellatrix', x: 90, y: 34, r: 3.8, color: '#dfe6ff' },
  { id: 'alnitak', x: 52, y: 66, r: 4.2, color: '#ffffff', belt: true },
  { id: 'alnilam', x: 64, y: 62, r: 4.8, color: '#ffffff', belt: true },
  { id: 'mintaka', x: 76, y: 58, r: 4.2, color: '#ffffff', belt: true },
  { id: 'saiph', x: 42, y: 100, r: 3.8, color: '#cfe0ff' },
  { id: 'rigel', x: 92, y: 98, r: 5.2, color: '#9cc8ff' },
];

const LINES = ['M38 30 L52 66', 'M90 34 L76 58', 'M52 66 L64 62 L76 58', 'M52 66 L42 100', 'M76 58 L92 98'];

export type LogoOptions = {
  /** Thicker lines and bigger stars, for 16 and 32 pixel icons. */
  small?: boolean;
  /** Pink halo, used while capturing. */
  live?: boolean;
  /** Prefix for gradient and filter ids, so two inline logos on one page do not collide. */
  idPrefix?: string;
};

export function logoSvg({ small = false, live = false, idPrefix = 'orion' }: LogoOptions = {}): string {
  const id = (name: string) => `${idPrefix}-${name}`;
  const halo = live ? '#ff5c7a' : '#7c6cff';
  const stroke = small ? 6 : 2.6;
  const grow = small ? 1.7 : 1;
  const stars = STARS.map(
    (s) =>
      `<g class="star${s.belt ? ' belt' : ''}" data-star="${s.id}">` +
      `<circle cx="${s.x}" cy="${s.y}" r="${(s.r * 2.2 * grow).toFixed(1)}" fill="${s.color}" opacity=".35" filter="url(#${id('glow')})"/>` +
      `<circle cx="${s.x}" cy="${s.y}" r="${(s.r * grow).toFixed(1)}" fill="${s.color}"/>` +
      `</g>`,
  ).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="Orion">
<defs>
<linearGradient id="${id('bg')}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#171c3f"/><stop offset="1" stop-color="#070914"/></linearGradient>
<radialGradient id="${id('halo')}" cx=".5" cy=".5" r=".5"><stop offset="0" class="halo-stop" stop-color="${halo}" stop-opacity=".5"/><stop offset="1" class="halo-stop" stop-color="${halo}" stop-opacity="0"/></radialGradient>
<linearGradient id="${id('line')}" gradientUnits="userSpaceOnUse" x1="20" y1="20" x2="108" y2="108"><stop offset="0" stop-color="#9aa8ff"/><stop offset="1" stop-color="#c49bff"/></linearGradient>
<filter id="${id('glow')}" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="${small ? 3 : 2.4}"/></filter>
</defs>
<rect width="128" height="128" rx="30" fill="url(#${id('bg')})"/>
<circle class="halo" cx="64" cy="64" r="${small ? 40 : 48}" fill="url(#${id('halo')})"/>
<g fill="none" stroke="url(#${id('line')})" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" opacity=".85">
${LINES.map((d) => `<path class="line" d="${d}"/>`).join('')}
</g>
${stars}
</svg>`;
}
