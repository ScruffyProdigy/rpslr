import { useCallback, useEffect, useState } from 'react';
import type { MatchState } from '../api';

/**
 * How long the loadout reveal holds before the board takes over.
 *
 * Four cards to read — two names, two tiers, two blurbs a side — so it is longer
 * than the round showdown's 2.6s and still a fraction of what it sits inside.
 *
 * It sits *inside* round 1's existing 60s pick allowance rather than adding a
 * phase of its own (JQ-156 offered both). Round 1 is long because it is
 * read-time plus decide-time — the how-to-play panels open themselves over the
 * board on a first match — and in helpers mode this is that same reading. Nine
 * seconds of it leaves 51s to pick in, still more than double what every later
 * round gets. The cheaper half of the trade is the point: a segment inside an
 * allowance the server already runs down cannot stall a match, where a phase
 * with a deadline of its own is one more thing that can.
 */
export const LOADOUT_REVEAL_MS = 9_000;

export interface LoadoutReveal {
  /** Whether the reveal should be on screen right now. */
  open: boolean;
  /** Close it early — the skip. */
  dismiss: () => void;
}

/**
 * Whether the match is still inside the window in which loadouts are revealed.
 *
 * Anchored to the *server's* clock, not to a mount: the window is measured from
 * `match.phaseStartedAt`, which is when the last seat was claimed and round 1
 * went on the clock, against the `serverNow` every snapshot carries. So a reload
 * ten seconds in restores a board with no reveal on it, rather than replaying a
 * reveal the player already sat through — the same reason the countdown reads
 * server time rather than the device's, which may be minutes off.
 *
 * `duel` never opens it, because `duel` brings no loadout. The test is the
 * loadout itself rather than the mode key, which is the repo's convention: the
 * duel opening is the null loadout rather than a special case.
 */
export function useLoadoutReveal(
  state: MatchState | null,
  /** Whose board this is. A seat that has already picked is past the reveal. */
  viewerPlayerId: string | null,
  windowMs: number = LOADOUT_REVEAL_MS,
): LoadoutReveal {
  const matchId = state?.match.id ?? null;
  const startedAtIso = state?.match.phaseStartedAt ?? null;

  const eligible =
    state != null &&
    state.match.status === 'playing' &&
    state.match.currentRound <= 1 &&
    state.results.length === 0 &&
    state.seats.some((seat) => seat.loadout != null) &&
    // A reload after locking in comes back to the board, not to the reveal. The
    // loadouts are still one tap away from either seat card, which is where a
    // player who wants them after that goes anyway.
    !(viewerPlayerId != null && (state.submittedPlayerIds ?? []).includes(viewerPlayerId));

  const startedAt = startedAtIso ? Date.parse(startedAtIso) : NaN;
  const serverNow = state?.serverNow ? Date.parse(state.serverNow) : NaN;
  const remainingMs =
    eligible && !Number.isNaN(startedAt) && !Number.isNaN(serverNow)
      ? windowMs - (serverNow - startedAt)
      : null;

  const [dismissed, setDismissed] = useState(false);
  const [expired, setExpired] = useState(false);

  // A different match is a different reveal. Keyed on the phase start as well,
  // so a match that somehow re-opened round 1 gets a clean window rather than
  // one already marked spent.
  useEffect(() => {
    setDismissed(false);
    setExpired(false);
  }, [matchId, startedAt]);

  useEffect(() => {
    if (remainingMs === null || remainingMs <= 0) return;
    const timer = setTimeout(() => setExpired(true), remainingMs);
    return () => clearTimeout(timer);
    // Re-armed on every snapshot, and deliberately: each one re-measures the
    // remaining time against the server's clock, so a tab that was backgrounded
    // through the window comes back to a closed reveal rather than a fresh one.
  }, [remainingMs]);

  const dismiss = useCallback(() => setDismissed(true), []);

  return {
    open: remainingMs !== null && remainingMs > 0 && !expired && !dismissed,
    dismiss,
  };
}
