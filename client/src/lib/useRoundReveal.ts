import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoundResult } from '../api';

/** How long the showdown card holds the pentagon centre before the next round. */
export const REVEAL_HOLD_MS = 2000;

/**
 * Watches the results list and returns the round that just landed, so the
 * board can show it before handing the centre back to the picker.
 *
 * The seen-count starts at whatever is already on screen, so reloading
 * mid-match replays nothing. Motion is a CSS concern: under
 * `prefers-reduced-motion` the same card appears without animating, rather
 * than the result never being shown at all.
 */
export function useRoundReveal(
  results: RoundResult[],
  holdMs: number = REVEAL_HOLD_MS,
): { revealing: RoundResult | null; skip: () => void } {
  const seenRef = useRef(results.length);
  const [revealing, setRevealing] = useState<RoundResult | null>(null);
  const count = results.length;

  useEffect(() => {
    if (count === seenRef.current) return;
    // A shorter list means a different match, not a new round.
    if (count < seenRef.current) {
      seenRef.current = count;
      setRevealing(null);
      return;
    }
    seenRef.current = count;
    setRevealing(results[count - 1]);
  }, [count, results]);

  useEffect(() => {
    if (!revealing) return;
    const timer = setTimeout(() => setRevealing(null), holdMs);
    return () => clearTimeout(timer);
  }, [revealing, holdMs]);

  const skip = useCallback(() => setRevealing(null), []);

  return { revealing, skip };
}
