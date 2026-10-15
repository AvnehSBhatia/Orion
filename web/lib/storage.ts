// Browser storage, wrapped: private mode or blocked storage must never break the page.

export const ORG_KEY = "orion.org";
export const userKey = (orgId: string) => `orion.user.${orgId}`;
export const conversationKey = (orgId: string, userId: string) => `orion:chat:${orgId}:${userId}`;
/** Set once the intro has played, so returning users land on their dashboard. */
export const INTRO_SEEN_KEY = "orion.introSeen";

export function readStored(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The choice just will not survive a reload.
  }
}

export function readSession(key: string) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeSession(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // The conversation just will not survive a reload.
  }
}

/** On sign-out: drop every conversation kept for this tab. */
export function clearConversations() {
  try {
    for (const key of Object.keys(window.sessionStorage)) if (key.startsWith("orion:chat:")) window.sessionStorage.removeItem(key);
  } catch {
    // Nothing stored.
  }
}
