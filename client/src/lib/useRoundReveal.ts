import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoundResult } from '../api';

/** How long the showdown card holds before it starts dissolving. */
export const REVEAL_HOLD_MS = 2600;
/** The dissolve, during which the winning arrow lights on the graph beneath. */
export const REVEAL_OUTRO_MS = 600;

export type RevealPhase = 'card' | 'outro';

export interface Reveal {
  result: RoundResult;
  phase: RevealPhase;
}

/**
 * Watches the results list and returns the round that just landed, so the
 * board can play it out before handing the centre back to the picker.
 *
 * Two phases: the card holds, then dissolves onto the pentagon edge the round
 * was won on. The picker stays inert for both — it is deliberate dead time,
 * and a rest between decisions.
 *
 * The seen-count starts at whatever is already on screen, so reloading
 * mid-match replays nothing. Motion is a CSS concern: under
 * `prefers-reduced-motion` the same card appears without animating, rather
 * than the result never being shown at all.
 */
export function useRoundReveal(
  results: RoundResult[],
  holdMs: number = REVEAL_HOLD_MS,
  outroMs: number = REVEAL_OUTRO_MS,
): { reveal: Reveal | null; skip: () => void } {
  const seenRef = useRef(results.length);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const count = results.length;

  useEffect(() => {
    if (count === seenRef.current) return;
    // A shorter list means a different match, not a new round.
    if (count < seenRef.current) {
      seenRef.current = count;
      setReveal(null);
      return;
    }
    seenRef.current = count;
    setReveal({ result: results[count - 1], phase: 'card' });
  }, [count, results]);

  useEffect(() => {
    if (!reveal) return;
    const timer = setTimeout(
      () => setReveal((cur) => (cur?.phase === 'card' ? { ...cur, phase: 'outro' } : null)),
      reveal.phase === 'card' ? holdMs : outroMs,
    );
    return () => clearTimeout(timer);
  }, [reveal, holdMs, outroMs]);

  // Tapping means "I've got it" — end both phases, not just the card.
  const skip = useCallback(() => setReveal(null), []);

  return { reveal, skip };
}
