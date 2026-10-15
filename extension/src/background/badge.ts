// The toolbar icon and badge always say what is going on:
//   recording        red "ON" on the active (recording) icon
//   paused           grey "II"
//   needs attention  amber "!" (signed out, or the notice must be accepted)
//   idle             no badge

import { isPaused } from '../lib/policy.ts';
import { getLocal } from '../privacy';
import { getRecording } from '../recording';

const ICON_SIZES = [16, 32, 48, 128] as const;
const icons = (variant: 'icon' | 'active') =>
  Object.fromEntries(ICON_SIZES.map((s) => [s, `icons/${variant}-${s}.png`])) as Record<string, string>;

const RED = '#FF5C7A';
const GREY = '#7A8399';
const AMBER = '#F5A524';

export async function refreshBadge(): Promise<void> {
  const [rec, local] = await Promise.all([getRecording(), getLocal()]);
  const paused = isPaused(local.pausedUntil);
  let text = '';
  let color = RED;
  let title = 'Orion';
  if (local.attention) {
    text = '!';
    color = AMBER;
    title = local.attention === 'signed_out' ? 'Orion: sign in again' : 'Orion: review the monitoring notice';
  } else if (rec.recording && paused) {
    text = 'II';
    color = GREY;
    title = 'Orion: paused';
  } else if (rec.recording) {
    text = 'ON';
    title = 'Orion: capturing';
  }
  await Promise.all([
    chrome.action.setBadgeText({ text }),
    chrome.action.setBadgeBackgroundColor({ color }),
    chrome.action.setTitle({ title }),
    chrome.action.setIcon({ path: icons(rec.recording && !paused && !local.attention ? 'active' : 'icon') }).catch(() => {}),
  ]);
}
