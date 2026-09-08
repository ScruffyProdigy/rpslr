/**
 * How a win is phrased — copied, deliberately, from client/src/moves.ts.
 *
 * Same contract as tokens.ts: the API cannot import across the package
 * boundary, and a card that phrases a win differently from the board that
 * showed it is worse than a copy someone has to keep in step. If you change a
 * verb in the client, change it here too. `moveVerbs.test.ts` holds this table
 * to exactly the matchups the shared graph decides, so one that gains or loses
 * a verb fails there rather than shipping a card that says "over".
 *
 * A helper can hand one player an edge the shared graph does not have — Chimera's
 * `lizard → scissors` — and the card cannot tell that it did: it renders a
 * finished match, where the winner is already recorded, and no loadout travels
 * with it. So a pair this table does not name is phrased rather than refused.
 * `beats` is the word the client falls back to for the same pair, which is what
 * keeps card and board in step, and it needs no edit when the next per-player
 * edge arrives.
 */
import { MOVES, type Move } from '../game.js';

/** The shared graph's ten matchups. A per-player edge is deliberately absent. */
const BEAT_VERBS: Record<Move, Partial<Record<Move, string>>> = {
  rock: { scissors: 'crushes', lizard: 'crushes' },
  paper: { rock: 'covers', robot: 'disproves' },
  scissors: { paper: 'cuts', lizard: 'decapitates' },
  lizard: { paper: 'eats', robot: 'poisons' },
  robot: { scissors: 'smashes', rock: 'vaporizes' },
};

/** What an unnamed matchup is called. The client's word for the same pair. */
export const FALLBACK_VERB = 'beats';

/**
 * The verb for a win, e.g. `robot` over `rock` is "vaporizes". A pair outside
 * the shared graph gets `beats`: the caller is holding a winner the server
 * already decided, so the pair is a win whether or not this table names it.
 */
export function beatVerb(winner: Move, loser: Move): string {
  return BEAT_VERBS[winner]?.[loser] ?? FALLBACK_VERB;
}

/**
 * Sentence case, as the card draws it: "Paper covers Rock". Null only for a
 * move against itself — a draw, with no winner to phrase.
 */
export function showdownCaption(winner: Move, loser: Move): string | null {
  if (winner === loser) return null;
  return `${titleCase(winner)} ${beatVerb(winner, loser)} ${titleCase(loser)}`;
}

/** Every matchup this table names, for the test that compares it with BEATS. */
export function verbPairs(): Array<[Move, Move]> {
  return MOVES.flatMap((winner) =>
    Object.keys(BEAT_VERBS[winner]).map((loser) => [winner, loser] as [Move, Move]),
  );
}

function titleCase(move: Move): string {
  return move[0].toUpperCase() + move.slice(1);
}
