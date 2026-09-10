/**
 * Oracle's reveal: one live move the opponent did *not* play.
 *
 * Naming a move they did not play is the whole reason this is safe. The
 * opponent's actual commitment never leaves the server, so commit-then-reveal
 * survives intact — the holder narrows the field by one rather than being handed
 * the answer. An earlier design that revealed the real move would have broken
 * that outright.
 *
 * Pure, and separated from the service, for a reason beyond testability: the
 * draw must happen exactly once per firing and then be written down. A reveal
 * re-rolled on every read would let the holder reconnect repeatedly, collect
 * every move the server is willing to name, and identify the opponent's move as
 * the one it never names. The persistence is the service's job; keeping the roll
 * in one small function is what makes "called once" reviewable.
 */

import { availableMoves, type DelayMap, type Move } from '../game.js';

/**
 * A move drawn uniformly from the opponent's live moves, excluding the one they
 * played. Null when they played their only live move — there is nothing they did
 * not play, so Oracle has nothing to name.
 *
 * Liveness comes from `availableMoves` rather than a `delays[m] === 0` test, so
 * the "you always have something to play" floor is honoured here too: when
 * helpers have marked everything, the least-marked moves are what the opponent
 * could have played, and so are what Oracle may name.
 */
export function nameUnplayedMove(
  opponentDelays: DelayMap,
  played: Move,
  rng: () => number,
): Move | null {
  const candidates = availableMoves(opponentDelays).filter((m) => m !== played);
  if (candidates.length === 0) return null;
  // Math.min guards rng() === 1, which would index one past the end.
  return candidates[Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))];
}
