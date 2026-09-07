import type { Move } from './api';

/**
 * Presentation helpers for the five moves. Pure -> easy to unit test.
 *
 * The emoji that used to live here are gone: every surface draws the move with
 * <MoveIcon> now, and an unused "fallback" field is one more thing to keep in
 * step with nothing.
 */
export const MOVE_META: Record<Move, { label: string }> = {
  rock: { label: 'Rock' },
  paper: { label: 'Paper' },
  scissors: { label: 'Scissors' },
  lizard: { label: 'Lizard' },
  robot: { label: 'Robot' },
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
 * The beats graph as text.
 *
 * The board draws the pentagon into an `aria-hidden` SVG, so this is the whole
 * graph for anyone who cannot see it: five lines carry all ten edges, and one
 * closing line names the attacks the opponent cannot make this round — the
 * faded arrows a sighted player reads straight off the board.
 */
export function describeBeatsGraph(oppDelays: Record<string, number>): {
  edges: string[];
  opponent: string;
} {
  const edges = ALL_MOVES.map(describeBeatsOf);
  const off = ALL_MOVES.filter((m) => (oppDelays[m] ?? 0) > 0).map((m) => MOVE_META[m].label);
  if (off.length === 0) {
    return {
      edges,
      opponent: 'The opponent can play every move this round, so every arrow is live.',
    };
  }
  const list =
    off.length === 1 ? off[0] : `${off.slice(0, -1).join(', ')} or ${off[off.length - 1]}`;
  return {
    edges,
    opponent: `The opponent can't play ${list} this round, so those attacks are drawn faded.`,
  };
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

/** The pentagon edge a round was won on, and whose win it was. */
export interface WinningEdge {
  from: Move;
  to: Move;
  role: 'you' | 'opp';
}

/**
 * The single arrow that decided a round, so the reveal can light it on the
 * graph. The edge belongs to the graph — `from` always beats `to` — and only
 * `role` depends on who played it. A mirror match has no edge.
 */
export function winningEdgeOf(myMove: Move, oppMove: Move): WinningEdge | null {
  if (beatsOf(myMove).includes(oppMove)) return { from: myMove, to: oppMove, role: 'you' };
  if (beatsOf(oppMove).includes(myMove)) return { from: oppMove, to: myMove, role: 'opp' };
  return null;
}

/**
 * Why one of your moves is unavailable. Read off your own last two picks
 * rather than inferred from the mark count, so it stays true if helpers ever
 * change what a move costs. `recent` is most-recent-first.
 */
export function cooldownCause(move: Move, recent: Move[]): string {
  const name = MOVE_META[move].label;
  if (recent[0] === move) return `You played ${name} last round`;
  if (recent[1] === move) return `You played ${name} two rounds ago`;
  return `${name} starts the match on cooldown`;
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
