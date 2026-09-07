import type { RoundDeadline } from '../lib/useRoundDeadline';

/**
 * How long is left in this round.
 *
 * One clock, not two. Both players race the same server-side deadline, so the
 * number you see is also the number your opponent sees — which is what makes
 * waiting bearable: the wait has a visible end.
 *
 * ## Why a ring and not just a number
 *
 * The player is looking at the pentagon, not at the scoreboard. A numeral only
 * registers if you look straight at it; a depleting arc registers in peripheral
 * vision, which is the whole job — it has to be noticeable without demanding
 * that you stop deciding in order to read it.
 *
 * It sits between the two seat cards, which are already 201px tall, so the ring
 * costs no page height. That matters: the board overflows a 390x844 phone
 * (JQ-165), so a clock that added a row would be paid for somewhere else.
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

/** Geometry of the ring. Radius and stroke are also fixed in the stylesheet. */
const RADIUS = 28;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function RoundTimer({ deadline }: { deadline: RoundDeadline }) {
  const { secondsLeft, totalSeconds } = deadline;
  if (secondsLeft === null) return null;

  // Below a quarter of the allowance, and always in the last five seconds —
  // five is urgent whatever the allowance, and a quarter of round 1's 45s is
  // still 11s, which is too late to be the only warning.
  const urgent =
    secondsLeft <= 5 || (totalSeconds !== null && secondsLeft <= Math.ceil(totalSeconds / 4));
  const critical = secondsLeft <= 5;

  // Without a known allowance the ring has nothing honest to draw, so it stays
  // full and the numeral carries the whole message.
  const remaining = totalSeconds ? Math.min(1, Math.max(0, secondsLeft / totalSeconds)) : 1;

  return (
    <span
      className={[
        'round-timer',
        urgent ? 'round-timer--urgent' : '',
        critical ? 'round-timer--critical' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      // Announcing every tick would make the board unusable with a screen
      // reader. The number is here to read on demand; expiry itself is
      // announced by the reveal.
      aria-live="off"
      aria-label={`${secondsLeft} seconds left this round`}
    >
      <svg className="round-timer__ring" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <circle className="round-timer__track" cx="32" cy="32" r={RADIUS} />
        <circle
          className="round-timer__arc"
          cx="32"
          cy="32"
          r={RADIUS}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - remaining)}
        />
      </svg>
      <span className="round-timer__value" aria-hidden="true">
        {secondsLeft}
      </span>
    </span>
  );
}
