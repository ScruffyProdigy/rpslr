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

/** Spoken form of a cooldown, e.g. "on cooldown, 2 turns". */
export function cooldownPhrase(turns: number): string {
  return `on cooldown, ${turns} turn${turns === 1 ? '' : 's'}`;
}

/**
 * Winner-over-loser phrasing from the official RPSLR rules copy. Key order is
 * the order the README lists them in, and `beatsOf` relies on it.
 */
const BEAT_VERBS: Partial<Record<Move, Partial<Record<Move, string>>>> = {
  rock: { scissors: 'crushes', lizard: 'crushes' },
  paper: { rock: 'covers', robot: 'disproves' },
  scissors: { paper: 'cuts', lizard: 'decapitates' },
  lizard: { paper: 'eats', robot: 'poisons' },
  robot: { scissors: 'smashes', rock: 'vaporizes' },
};

/** The two moves `move` beats, in rules-copy order. */
export function beatsOf(move: Move): Move[] {
  return Object.keys(BEAT_VERBS[move] ?? {}) as Move[];
}

/**
 * Preview caption for a move, e.g. "Rock crushes Scissors & Lizard" or
 * "Robot smashes Scissors & vaporizes Rock". A verb shared by both targets is
 * said once.
 */
export function describeBeatsOf(move: Move): string {
  const [a, b] = beatsOf(move);
  const verbs = BEAT_VERBS[move] ?? {};
  const name = MOVE_META[move].label;
  if (verbs[a] === verbs[b]) {
    return `${name} ${verbs[a]} ${MOVE_META[a].label} & ${MOVE_META[b].label}`;
  }
  return `${name} ${verbs[a]} ${MOVE_META[a].label} & ${verbs[b]} ${MOVE_META[b].label}`;
}

/**
 * What can beat `move` this round. `all` is the two moves that beat it; `live`
 * drops the ones the opponent has on cooldown, so `safe` means the move cannot
 * lose. This is the same read a familiar player makes off the pentagon — a node
 * with no solid incoming arrows — so the picker draws arrows from it.
 */
export function threatsTo(
  move: Move,
  oppDelays: Record<string, number>,
): { all: Move[]; live: Move[]; safe: boolean } {
  const all = ALL_MOVES.filter((m) => beatsOf(m).includes(move));
  const live = all.filter((m) => (oppDelays[m] ?? 0) === 0);
  return { all, live, safe: live.length === 0 };
}

/** Spoken form of an opponent cooldown, for the preview caption. */
export function opponentCooldownPhrase(move: Move, turns: number): string {
  return `Opponent can't play ${MOVE_META[move].label} for ${turns} turn${turns === 1 ? '' : 's'}`;
}

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
