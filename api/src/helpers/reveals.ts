/**
 * The abilities that hand their *own holder* information mid-round, and how each
 * decides what to say.
 *
 * A different axis from `Reveal` in `roster.ts`, which says whether the opponent
 * sees a firing happen. Oracle is `secret` on that axis — the move it names stays
 * hidden from the opponent until the round resolves — and still belongs here,
 * because it tells its holder something after their own commitment. The two
 * questions are separate and are deliberately not collapsed into one field.
 *
 * A registry rather than a flag on the card, because "informs its holder" is not
 * usefully separable from "here is what it tells them": a card that declared the
 * first without supplying the second would open a window with nothing in it. One
 * entry, one source of truth, and no drift to guard against.
 *
 * It lives with the cards for the same reason `rules.ts` does — the service knows
 * the *class* of behaviour and never an ability's id, so a second member arrives
 * by being added here rather than by the round protocol growing a branch.
 */

import type { DelayMap, Move } from '../game.js';
import { nameUnplayedMove } from './oracle.js';

/**
 * What one ability tells its holder, drawn once when both players have locked in.
 *
 * Takes the opponent's marks as they stood *entering* the round — what they were
 * choosing from, and the same basis `submitMove` validates a pick against — so a
 * reveal can never name a move the opponent could not have played.
 *
 * Pure, and called exactly once per firing: the result is written to the firing
 * row and read back thereafter. A draw re-rolled on every read would let a holder
 * reconnect repeatedly, collect every move the server is willing to name, and
 * identify the opponent's as the one it never names.
 */
export type RevealDraw = (ctx: {
  opponentDelays: DelayMap;
  opponentMove: Move;
  rng: () => number;
}) => Move | null;

const DRAWS: Readonly<Record<string, RevealDraw>> = {
  oracle: ({ opponentDelays, opponentMove, rng }) =>
    nameUnplayedMove(opponentDelays, opponentMove, rng),
};

/** How this ability decides what to tell its holder, or null if it tells them nothing. */
export function revealDrawFor(helperId: string): RevealDraw | null {
  return DRAWS[helperId] ?? null;
}

/**
 * Whether this ability reveals something to its holder mid-round — which is one of
 * the two ways a seat becomes entitled to the round's sub-phase.
 */
export function informsItsHolder(helperId: string): boolean {
  return revealDrawFor(helperId) !== null;
}
