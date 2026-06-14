import type { Move } from './api';

/** Presentation helpers for the five moves. Pure -> easy to unit test. */
export const MOVE_META: Record<Move, { emoji: string; label: string }> = {
  rock: { emoji: '🪨', label: 'Rock' },
  paper: { emoji: '📄', label: 'Paper' },
  scissors: { emoji: '✂️', label: 'Scissors' },
  lizard: { emoji: '🦎', label: 'Lizard' },
  robot: { emoji: '🤖', label: 'Robot' },
};

export const ALL_MOVES: Move[] = ['rock', 'paper', 'scissors', 'lizard', 'robot'];

/**
 * Outcome is the winning seat key (or 'draw'). Compare against the viewer's
 * seat key to render a verdict.
 */
export function describeOutcome(outcome: string, mySeatKey: string): 'win' | 'loss' | 'draw' {
  if (outcome === 'draw') return 'draw';
  return outcome === mySeatKey ? 'win' : 'loss';
}

/** Round wins required to take the match (e.g. best of 5 → first to 3). */
export function winsNeeded(bestOf: number): number {
  return Math.floor(bestOf / 2) + 1;
}

/** Winner-over-loser phrasing from the official RPSLR rules copy. */
const BEAT_VERBS: Partial<Record<Move, Partial<Record<Move, string>>>> = {
  rock: { scissors: 'crushes', lizard: 'crushes' },
  paper: { rock: 'covers', robot: 'disproves' },
  scissors: { paper: 'cuts', lizard: 'decapitates' },
  lizard: { paper: 'eats', robot: 'poisons' },
  robot: { scissors: 'smashes', rock: 'vaporizes' },
};

/** e.g. "Paper disproves Robot" */
export function describeBeat(winner: Move, loser: Move): string {
  const verb = BEAT_VERBS[winner]?.[loser];
  if (!verb) {
    return `${MOVE_META[winner].label} beats ${MOVE_META[loser].label}`;
  }
  return `${MOVE_META[winner].label} ${verb} ${MOVE_META[loser].label}`;
}

/** Narration for a resolved round's two picks. */
export function describeRoundMatchup(myMove: Move, oppMove: Move): string {
  if (myMove === oppMove) {
    return `${MOVE_META[myMove].label} vs ${MOVE_META[oppMove].label} — same pick, no winner`;
  }
  const iWin = BEAT_VERBS[myMove]?.[oppMove] != null;
  return describeBeat(iWin ? myMove : oppMove, iWin ? oppMove : myMove);
}

export function opponentMoveFromResult(
  moves: Record<string, Move>,
  myPlayerId: string,
): { myMove?: Move; oppMove?: Move } {
  const myMove = moves[myPlayerId];
  const oppId = Object.keys(moves).find((id) => id !== myPlayerId);
  const oppMove = oppId ? moves[oppId] : undefined;
  return { myMove, oppMove };
}
