import { useCallback, useEffect, useState } from 'react';
import type { MatchState } from '../api';

export interface LoadoutReveal {
  /** Whether the reveal sheet should be on screen right now. */
  open: boolean;
  /**
   * "I have read it." Closes the sheet here, and tells the server this seat is
   * done — round 1 starts once the other seat says the same, or when the phase
   * deadline runs out.
   */
  dismiss: () => void;
}

/**
 * Whether this seat should be looking at the loadout reveal.
 *
 * Almost nothing: the window is a server phase (JQ-149), so the client renders
 * what the match says it is doing rather than running a timer of its own. That is
 * what makes a reload restore instead of replay — there is no local clock to
 * restart, and a reconnecting player lands mid-phase exactly where the phase is.
 *
 * The one piece of local state is the dismissal. It has to be local as well as
 * sent, because the phase does not end until *both* seats have read it: a player
 * who is done should get the board back without waiting on the other, even though
 * they cannot act on it yet. The countdown beside the seat cards is the server's
 * own deadline, so the wait is legible rather than mysterious.
 *
 * `duel` never opens it, because `duel` brings no loadout and so never enters the
 * phase. Tested on the loadout anyway: the mode key is not this module's business,
 * and a sheet with nothing in it is worth refusing twice.
 */
export function useLoadoutReveal(state: MatchState | null): LoadoutReveal {
  const phase = state?.match.phase ?? null;
  const matchId = state?.match.id ?? null;
  const revealing =
    phase === 'loadouts' && (state?.seats.some((seat) => seat.loadout != null) ?? false);

  const [dismissed, setDismissed] = useState(false);

  // A different match is a different reveal, and leaving the phase means the next
  // one — if a mode ever has a second — starts unread rather than pre-dismissed.
  useEffect(() => {
    if (!revealing) setDismissed(false);
  }, [revealing, matchId]);

  const dismiss = useCallback(() => setDismissed(true), []);

  return { open: revealing && !dismissed, dismiss };
}
