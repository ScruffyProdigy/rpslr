/**
 * Pure Rock-Paper-Scissors-Lizard-Robot logic plus the "delay mark" cooldown
 * system. No I/O here so it is trivially testable.
 *
 * Cooldowns: a player may only choose a move with 0 delay marks. After each
 * choice, every move loses one mark (floored at 0) and the chosen move gains 2.
 * The match opens with lizard at 1 mark and robot at 2 (rock/paper/scissors 0).
 */

export const MOVES = ['rock', 'paper', 'scissors', 'lizard', 'robot'] as const;
export type Move = (typeof MOVES)[number];

/** What each move beats (RPSLR — every move beats exactly two others). */
const BEATS: Record<Move, Move[]> = {
  rock: ['scissors', 'lizard'],
  paper: ['rock', 'robot'],
  scissors: ['paper', 'lizard'],
  lizard: ['robot', 'paper'],
  robot: ['scissors', 'rock'],
};

/** Delay marks each move starts the match with. */
export const INITIAL_DELAYS: Record<Move, number> = {
  rock: 0,
  paper: 0,
  scissors: 0,
  lizard: 1,
  robot: 2,
};

/** How many delay marks the move you choose gains. */
export const DELAY_ON_CHOICE = 2;

export function isMove(value: unknown): value is Move {
  return typeof value === 'string' && (MOVES as readonly string[]).includes(value);
}

export type RoundOutcome = 'a' | 'b' | 'draw';

/**
 * Decide a single round between player A's and player B's moves.
 * Returns 'a' if A wins, 'b' if B wins, or 'draw'.
 */
export function decideRound(moveA: Move, moveB: Move): RoundOutcome {
  if (moveA === moveB) return 'draw';
  return BEATS[moveA].includes(moveB) ? 'a' : 'b';
}

export type DelayMap = Record<Move, number>;

/**
 * Replay a player's chosen moves (in order) to get their current delay marks.
 * Pass the moves the player has made in *resolved* rounds to get the state they
 * enter the next round with.
 */
export function computeDelays(moves: Move[]): DelayMap {
  const delays: DelayMap = { ...INITIAL_DELAYS };
  for (const move of moves) {
    for (const m of MOVES) delays[m] = Math.max(0, delays[m] - 1);
    delays[move] += DELAY_ON_CHOICE;
  }
  return delays;
}

/** Moves currently selectable (0 delay marks). */
export function availableMoves(delays: DelayMap): Move[] {
  return MOVES.filter((m) => delays[m] === 0);
}

/**
 * Given a target number of round wins (best-of derived), determine whether the
 * match is over and who won. Draw rounds do not count toward either score.
 */
export function matchWinner(
  scoreA: number,
  scoreB: number,
  winsNeeded: number,
): RoundOutcome | null {
  if (scoreA >= winsNeeded) return 'a';
  if (scoreB >= winsNeeded) return 'b';
  return null;
}

/** best-of N (e.g. 5) means first to floor(N/2)+1 wins (3). */
export function winsNeeded(bestOf: number): number {
  return Math.floor(bestOf / 2) + 1;
}
