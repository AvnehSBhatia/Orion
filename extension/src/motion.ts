// All popup and settings motion, on anime.js v4. Every effect has a reduced-motion branch that jumps
// straight to the end state, and the live loops are reverted when capturing stops.

import { animate, createTimeline, stagger, svg, utils, type JSAnimation } from 'animejs';

const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
const reduced = () => motionQuery.matches;

const all = (root: ParentNode, selector: string) => Array.from(root.querySelectorAll<HTMLElement | SVGElement>(selector));

/** Stars twinkle in, the constellation lines draw between them, then the visible content rises in. */
export function intro(logo: Element, content: Element[]): void {
  const stars = all(logo, '.star');
  const lines = svg.createDrawable(all(logo, '.line'));
  if (reduced()) {
    utils.set(content, { opacity: 1, translateY: 0 });
    return;
  }
  utils.set(stars, { scale: 0, opacity: 0 });
  utils.set(lines, { draw: '0 0' });
  createTimeline({ defaults: { ease: 'outCubic' } })
    .add(stars, { scale: [0, 1], opacity: [0, 1], duration: 420, delay: stagger(55), ease: 'outBack(1.8)' })
    .add(lines, { draw: ['0 0', '0 1'], duration: 520, delay: stagger(70), ease: 'inOutSine' }, '-=300')
    .add(content, { opacity: [0, 1], translateY: [10, 0], duration: 320, delay: stagger(40, { start: 0 }) }, '-=520');
}

/** Brings a view's items in after it is shown. */
export function enter(items: Element[]): void {
  if (reduced()) {
    utils.set(items, { opacity: 1, translateY: 0 });
    return;
  }
  animate(items, { opacity: [0, 1], translateY: [8, 0], duration: 260, delay: stagger(35), ease: 'outCubic' });
}

let pulse: JSAnimation | null = null;
let beacon: JSAnimation | null = null;

/** While capturing, the belt breathes and the status dot sends out a soft ring. */
export function setLive(logo: Element, ring: Element, live: boolean): void {
  pulse?.revert();
  beacon?.revert();
  pulse = beacon = null;
  logo.classList.toggle('live', live);
  if (!live || reduced()) return;
  pulse = animate(all(logo, '.star.belt'), {
    scale: [1, 1.35],
    duration: 900,
    delay: stagger(150),
    loop: true,
    alternate: true,
    ease: 'inOutSine',
  });
  beacon = animate(ring, { scale: [1, 2.6], opacity: [0.7, 0], duration: 1400, loop: true, ease: 'outSine' });
}

/** A ripple from the capture button when it changes state. */
export function ripple(el: Element): void {
  if (reduced()) return;
  animate(el, { scale: [0.6, 1.25], opacity: [0.55, 0], duration: 650, ease: 'outExpo' });
}

/** Counts a number up to its new value instead of jumping. */
export function countTo(el: HTMLElement, to: number): void {
  const from = Number(el.dataset.value ?? 0);
  el.dataset.value = String(to);
  if (from === to || reduced()) {
    el.textContent = String(to);
    return;
  }
  const n = { value: from };
  animate(n, {
    value: to,
    duration: 500,
    ease: 'outExpo',
    onUpdate: () => {
      el.textContent = String(Math.round(n.value));
    },
  });
}

/** Swaps a line of text with a short fade and lift. */
export function swapText(el: HTMLElement, text: string): void {
  if (el.textContent === text) return;
  el.textContent = text;
  if (reduced() || !text) return;
  animate(el, { opacity: [0, 1], translateY: [4, 0], duration: 200, ease: 'outQuad' });
}

/** Buttons dip on press and spring back on release. */
export function pressable(el: HTMLElement): void {
  if (reduced()) return;
  el.addEventListener('pointerdown', () => animate(el, { scale: 0.97, duration: 120, ease: 'outQuad' }));
  for (const type of ['pointerup', 'pointerleave'] as const) {
    el.addEventListener(type, () => animate(el, { scale: 1, duration: 320, ease: 'outBack(2)' }));
  }
}

/** A short horizontal shake for a field the user needs to fix. */
export function nudge(el: Element): void {
  if (reduced()) return;
  animate(el, { translateX: [0, -6, 6, -3, 3, 0], duration: 360, ease: 'outQuad' });
}
