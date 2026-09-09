/**
 * Round deadlines and the idle policy. Pure — no I/O, no clock of its own —
 * so the whole policy is testable without waiting for real time to pass.
 *
 * A player who locks in and walks away used to stall a match forever. Every
 * phase now carries a server-authoritative deadline; when it passes, one of
 * three things happens (see `decidePenalty`):
 *
 *   1st expiry            a live move is picked for them and play continues
 *   2nd consecutive       they forfeit the match
 *   gone past the grace   they forfeit the match, without waiting out rounds
 *
 * The third case is what separates "absent" from "merely slow": a player whose
 * socket has been gone longer than the grace period is not thinking.
 *
 * ## Why a *phase* deadline rather than a round deadline
 *
 * A round is not always one decision. `duel-helpers` has an Oracle sub-phase —
 * after both players lock in, a charge-holder who paid for it may re-pick before
 * the round resolves — and its draft screen will have a deadline of its own
 * before round 1. Keying the deadline to a phase is what let Oracle land without
 * touching a single existing call site.
 *
 * @see docs/superpowers/specs/2026-09-07-jq-156-round-timer-design.md
 */

import { availableMoves, type DelayMap, type Move } from './game.js';

/**
 * A timed segment of a match. `oracle` is the mid-round sub-phase JQ-150 adds —
 * between both-locked and resolve, and only when the Oracle holder has paid for
 * it. `duel-helpers` will add `draft` too, which is why this stays a union.
 */
export type Phase = 'pick' | 'oracle';

export interface RoundPolicy {
  /** How long a player has in this phase. Round 1 is deliberately longer. */
  allowanceMs(phase: Phase, round: number): number;
  /** Consecutive expiries that end the match. */
  strikesToForfeit: number;
  /** How long a disconnected player is left alone before forfeiting. */
  disconnectGraceMs: number;
}

/**
 * Round 1 is read-time plus decide-time: the how-to-play panels open themselves
 * over the board on a player's first match ever (JQ-96), and a thorough first
 * read is plausibly 30s. Later rounds only have to cover a two-tap pick.
 */
const FIRST_ROUND_MS = 45_000;
const LATER_ROUND_MS = 20_000;

/**
 * Dead time at the top of every round after the first: the client plays the
 * previous round's showdown with the picker inert, and only hands the board
 * back when it finishes. Charging that to the player's thinking time would
 * spend ~16% of a 20s round on an animation they cannot act during.
 *
 * Added to the allowance rather than deferring the deadline until the client
 * reports the reveal finished — that would put a client-reported event in
 * charge of a server-authoritative deadline, which is the thing this design is
 * avoiding. Round 1 has no preceding round, so it pays nothing.
 *
 * Mirrors REVEAL_HOLD_MS + REVEAL_OUTRO_MS in
 * `client/src/lib/useRoundReveal.ts`. The coupling is deliberate but loose: the
 * server is being generous, so the two drifting apart costs a second of extra
 * thinking time, not a wrong forfeit. Skipping the reveal is likewise just
 * generous.
 */
const REVEAL_DEAD_TIME_MS = 3_200;

/**
 * Oracle's sub-phase: one narrow decision — keep the move you already chose, or
 * swap it for another live one — taken with the reveal already in hand. Shorter
 * than a pick because the thinking that a pick pays for has already happened,
 * and because the opponent is locked in and waiting through every second of it.
 *
 * Round-independent: there is no first-round reading to do here, and no reveal
 * animation to sit through, so neither of the pick allowances' two adjustments
 * applies.
 */
const ORACLE_MS = 12_000;

export const DUEL_POLICY: RoundPolicy = {
  allowanceMs: (phase, round) =>
    phase === 'oracle'
      ? ORACLE_MS
      : round <= 1
        ? FIRST_ROUND_MS
        : LATER_ROUND_MS + REVEAL_DEAD_TIME_MS,
  strikesToForfeit: 2,
  disconnectGraceMs: 45_000,
};

/**
 * Modes share one policy until one of them needs its own. `duel-helpers` is
 * listed explicitly rather than left to the fallback so that adding the mode
 * does not silently invent a second idle policy.
 */
const POLICY_BY_MODE: Record<string, RoundPolicy> = {
  duel: DUEL_POLICY,
  'duel-helpers': DUEL_POLICY,
};

export function policyForMode(modeKey: string): RoundPolicy {
  return POLICY_BY_MODE[modeKey] ?? DUEL_POLICY;
}

/** Absolute epoch-ms deadline for a phase that started at `startedAtMs`. */
export function deadlineFor(
  policy: RoundPolicy,
  phase: Phase,
  round: number,
  startedAtMs: number,
): number {
  return startedAtMs + policy.allowanceMs(phase, round);
}

/**
 * Pick a move for a player who did not pick one themselves: uniformly at random
 * from the moves currently off cooldown.
 *
 * Random rather than "safest": a chosen-for-you move that happens to be the
 * strongest available would reward walking away. Uniform is neutral, and the
 * pick still spends a cooldown, so absence carries a real cost into the rounds
 * that follow. It also can't be predicted by an opponent watching the clock.
 *
 * Reads liveness through `availableMoves` rather than reimplementing it, so a
 * mode that changes what "live" means (Ferrus, Featherweight) stays correct.
 */
export function chooseAutoPick(delays: DelayMap, rng: () => number): Move {
  // `availableMoves` guarantees at least one, falling back to the least-marked
  // moves when helpers have blocked everything, so there is no empty case to
  // handle here any more.
  const live = availableMoves(delays);
  // Math.min guards rng() === 1, which would index one past the end.
  return live[Math.min(live.length - 1, Math.floor(rng() * live.length))];
}

export type ExpiryAction =
  | { kind: 'none' }
  | { kind: 'auto-pick' }
  | { kind: 'forfeit'; reason: 'strikes' | 'disconnect' };

/**
 * What the policy does to one player, right now. Called on every state read and
 * every move, so it must be a pure function of its inputs — the caller applies
 * the result idempotently.
 */
export function decidePenalty(input: {
  policy: RoundPolicy;
  now: number;
  /** Epoch ms, or null when no phase is running (waiting/finished). */
  deadline: number | null;
  hasMoved: boolean;
  /** Consecutive expiries already on this player, before this one. */
  strikes: number;
  /** Epoch ms this player's last connection dropped, or null if connected. */
  disconnectedSince: number | null;
}): ExpiryAction {
  const { policy, now, deadline, hasMoved, strikes, disconnectedSince } = input;

  // A locked-in player owes nothing, however long they have been gone since.
  if (hasMoved) return { kind: 'none' };

  if (disconnectedSince !== null && now - disconnectedSince >= policy.disconnectGraceMs) {
    return { kind: 'forfeit', reason: 'disconnect' };
  }

  if (deadline === null || now < deadline) return { kind: 'none' };

  if (strikes + 1 >= policy.strikesToForfeit) {
    return { kind: 'forfeit', reason: 'strikes' };
  }
  return { kind: 'auto-pick' };
}
