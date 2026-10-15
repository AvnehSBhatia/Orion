// Some models (DeepSeek) occasionally write tool markup into the text; it is never shown.
export const LEAKED_CALL = /<\/?\s*[｜|]\s*(?:DSML|tool[▁_ ]?call)/i;

/** The text before any leaked tool markup. */
export function stripLeaked(text: string): string {
  const at = text.search(LEAKED_CALL);
  return (at < 0 ? text : text.slice(0, at)).trim();
}
