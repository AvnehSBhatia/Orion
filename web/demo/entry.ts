// Everything the app uses from demo mode, imported as "orion-demo". next.config.ts points that name here only
// when NEXT_PUBLIC_ORION_DEMO=true; otherwise it resolves to ./off.ts and none of this is bundled.

export const DEMO_BUILD: boolean = true;
export { DemoCaption } from "./DemoCaption";
export { DemoCardHint, DemoSectionHint } from "./DemoHints";
export { type ComposerControl, noteDemoSent, useDemo, useDemoKeys } from "./state";

/** Brings a dashboard card (by kind) into view once it renders. */
export function scrollToCard(kind: string) {
  let tries = 0;
  const find = () => {
    const card = document.querySelector(`[data-demo-card="${kind}"]`);
    if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
    else if (++tries < 12) window.setTimeout(find, 250);
  };
  window.setTimeout(find, 350);
}
