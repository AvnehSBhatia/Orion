// "orion-demo" in a normal build: the same surface as ./entry.ts, doing nothing. See next.config.ts.

import type * as Demo from "./entry";

const OFF = { on: false, step: null, index: 0, hidden: false } as const;

export const DEMO_BUILD: typeof Demo.DEMO_BUILD = false;
export type ComposerControl = Demo.ComposerControl;
export const DemoCaption: typeof Demo.DemoCaption = () => null;
export const DemoCardHint: typeof Demo.DemoCardHint = () => null;
export const DemoSectionHint: typeof Demo.DemoSectionHint = () => null;
export const noteDemoSent: typeof Demo.noteDemoSent = () => {};
export const useDemo: typeof Demo.useDemo = () => OFF;
export const useDemoKeys: typeof Demo.useDemoKeys = () => {};
export const scrollToCard: typeof Demo.scrollToCard = () => {};
