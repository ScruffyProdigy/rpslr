import type { RoundDeadline } from '../lib/useRoundDeadline';

/**
 * How long is left in this round.
 *
 * One clock, not two. Both players race the same server-side deadline, so the
 * number you see is also the number your opponent sees — which is exactly what
 * makes waiting bearable: the wait has a visible end.
 *
 * ## It must not react to lock-in state
 *
 * The timer renders identically whether or not either player has picked. That
 * is deliberate and load-bearing, not an oversight: the planned duel-helpers
 * mode has a Minor called Poker Face whose entire effect is that the opponent
 * is never told you have locked in. A clock that paused, dimmed, or restyled
 * itself the moment someone committed would leak precisely that. If a future
 * design wants the timer to acknowledge lock-in, Poker Face has to be handled
 * in the same change.
 *
 * @see docs/superpowers/specs/2026-09-07-jq-156-round-timer-design.md
 */
export function RoundTimer({ deadline }: { deadline: RoundDeadline }) {
  const { secondsLeft, totalSeconds } = deadline;
  if (secondsLeft === null) return null;

  // Below a quarter of the allowance, and always in the last five seconds.
  const urgent =
    secondsLeft <= 5 || (totalSeconds !== null && secondsLeft <= Math.ceil(totalSeconds / 4));

  return (
    <span
      className={`round-timer${urgent ? ' round-timer--urgent' : ''}`}
      // Announcing every tick would make a screen reader unusable. The number is
      // available on demand; expiry itself is announced by the reveal.
      aria-live="off"
      aria-label={`${secondsLeft} seconds left this round`}
    >
      <span aria-hidden="true">{secondsLeft}s</span>
    </span>
  );
}
