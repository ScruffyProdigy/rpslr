/**
 * One-time UI notes (the tap hint, the cooldown explainer) are remembered per
 * browser. Storage can throw — Safari private mode, blocked third-party
 * storage in an iframe — so every access is guarded and failure just means the
 * note shows again.
 */
const PREFIX = 'rpslr.seen.';

export type OneTimeNote = 'tapHint' | 'cooldownExplainer' | 'howToPlay';

export function hasSeen(note: OneTimeNote): boolean {
  try {
    return window.localStorage.getItem(PREFIX + note) === '1';
  } catch {
    return false;
  }
}

export function markSeen(note: OneTimeNote): void {
  try {
    window.localStorage.setItem(PREFIX + note, '1');
  } catch {
    /* storage unavailable — the note just shows again next time */
  }
}
