/**
 * How a win is phrased — copied, deliberately, from client/src/moves.ts.
 *
 * Same contract as tokens.ts: the API cannot import across the package
 * boundary, and a card that phrases a win differently from the board that
 * showed it is worse than a copy someone has to keep in step. If you change a
 * verb in the client, change it here too. `moveVerbs.test.ts` checks this table
 * against the game's own BEATS, so a move that gains or loses a matchup fails
 * here rather than shipping a card that says "over".
 */
import { MOVES, type Move } from '../game.js';

const BEAT_VERBS: Record<Move, Partial<Record<Move, string>>> = {
  rock: { scissors: 'crushes', lizard: 'crushes' },
  paper: { rock: 'covers', robot: 'disproves' },
  scissors: { paper: 'cuts', lizard: 'decapitates' },
  lizard: { paper: 'eats', robot: 'poisons' },
  robot: { scissors: 'smashes', rock: 'vaporizes' },
};

/** The verb for a winning matchup, or null when `winner` does not beat `loser`. */
export function beatVerb(winner: Move, loser: Move): string | null {
  return BEAT_VERBS[winner]?.[loser] ?? null;
}

/** Sentence case, as the card draws it: "Paper covers Rock". */
export function showdownCaption(winner: Move, loser: Move): string | null {
  const verb = beatVerb(winner, loser);
  return verb ? `${titleCase(winner)} ${verb} ${titleCase(loser)}` : null;
}

/** Every matchup this table claims, for the test that compares it with BEATS. */
export function verbPairs(): Array<[Move, Move]> {
  return MOVES.flatMap((winner) =>
    Object.keys(BEAT_VERBS[winner]).map((loser) => [winner, loser] as [Move, Move]),
  );
}

function titleCase(move: Move): string {
  return move[0].toUpperCase() + move.slice(1);
}
