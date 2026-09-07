import { useEffect, useState } from 'react';
import type { MatchState } from '../api';
import { prefersReducedMotion } from './reducedMotion';

/**
 * How long is left in the current phase, ticking once a second.
 *
 * The server owns the deadline; this only renders it. Both are absolute times,
 * and they are compared in *server* time: every snapshot carries `serverNow`,
 * so a device whose clock is minutes off still counts down correctly. Without
 * that offset a skewed clock would show a timer already expired, or one that
 * never runs out.
 */
export interface RoundDeadline {
  /** Whole seconds left, floored at 0. Null when nothing is on the clock. */
  secondsLeft: number | null;
  /** The phase's full allowance in seconds, for rendering progress. */
  totalSeconds: number | null;
  /** True once the clock has run out but the server has not yet resolved it. */
  expired: boolean;
}

const EMPTY: RoundDeadline = { secondsLeft: null, totalSeconds: null, expired: false };

export function useRoundDeadline(state: MatchState | null): RoundDeadline {
  const deadlineIso = state?.match.phaseDeadline ?? null;
  const startedAtIso = state?.match.phaseStartedAt ?? null;
  const serverNowIso = state?.serverNow ?? null;
  const round = state?.match.currentRound ?? null;

  // Offset between this device's clock and the server's, measured when the
  // snapshot arrived. Local elapsed time is trustworthy even when the absolute
  // clock is not, so we only need to correct the origin once per snapshot.
  const [origin, setOrigin] = useState<{ skewMs: number } | null>(null);

  useEffect(() => {
    if (!serverNowIso) {
      setOrigin(null);
      return;
    }
    const serverNow = Date.parse(serverNowIso);
    if (Number.isNaN(serverNow)) return;
    setOrigin({ skewMs: serverNow - Date.now() });
  }, [serverNowIso]);

  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!deadlineIso) return;
    // Reduced motion means no per-second repaint; the value still updates
    // whenever a new snapshot arrives, so the number stays broadly honest
    // without animating in place.
    if (prefersReducedMotion()) return;
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
    // `round` is in the deps so the interval restarts cleanly each round.
  }, [deadlineIso, round]);

  if (!deadlineIso || !origin) return EMPTY;

  const deadline = Date.parse(deadlineIso);
  if (Number.isNaN(deadline)) return EMPTY;

  const serverNowMs = Date.now() + origin.skewMs;
  const remainingMs = deadline - serverNowMs;

  // The allowance comes from the server as (deadline - phaseStartedAt), so it is
  // the same value on the snapshot that opened the round and on every snapshot
  // after it. Inferring it from arrival time instead would shrink the total as
  // the round ran down, and a progress ring drawn from that would never move.
  const startedAt = startedAtIso ? Date.parse(startedAtIso) : NaN;
  const totalSeconds = Number.isNaN(startedAt)
    ? null
    : Math.max(1, Math.round((deadline - startedAt) / 1000));

  return {
    secondsLeft: Math.max(0, Math.ceil(remainingMs / 1000)),
    totalSeconds,
    expired: remainingMs <= 0,
  };
}
