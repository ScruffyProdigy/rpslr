import type { MatchEndReason, MatchState, Move, RoundResult, Seat } from './api';
import { seatIdentity, type Identity } from './lib/seatProfile';
import { ALL_MOVES, threatsTo } from './moves';

/**
 * Rebuilding a finished match, round by round, from nothing but what
 * `GET /api/v1/matches/:ref` already returns.
 *
 * `results[]` records what was played and who took each round, but not the
 * cooldown state a round was played *into* — that is never stored, because in
 * a live match it is just the current seat state. It does not need to be:
 * cooldowns are a pure function of the move sequence, so this file re-derives
 * them the way the server does.
 *
 * The rule is mirrored from `api/src/game.ts`. If it changes there, the
 * arithmetic here and its tests change with it — that duplication is the price
 * of replaying a match the server no longer holds.
 */

export type DelayMap = Record<Move, number>;

/**
 * Delay marks each move starts a match with — `INITIAL_DELAYS` in game.ts.
 * Exported with `advanceDelays` so anything that needs to reason about the
 * cooldown clock reads it from here rather than writing the rule down again.
 */
export const INITIAL_DELAYS: DelayMap = {
  rock: 0,
  paper: 0,
  scissors: 0,
  lizard: 1,
  robot: 2,
};

/**
 * How many marks the chosen move gains — `DELAY_ON_CHOICE` in game.ts.
 * Exported so the commentary can say how long a move rests without writing
 * the number down a second time.
 */
export const DELAY_ON_CHOICE = 2;

/** Every move −1 floored at 0, then the pick +2. The order is the rule. */
export function advanceDelays(delays: DelayMap, chosen: Move): DelayMap {
  const next = { ...delays };
  for (const move of ALL_MOVES) next[move] = Math.max(0, next[move] - 1);
  next[chosen] += DELAY_ON_CHOICE;
  return next;
}

/** One player's standing at one round, as they entered it. */
export interface ReplaySide {
  seatKey: string;
  playerId: string;
  move: Move;
  /** Marks held entering the round — before this round's pick is charged. */
  delaysBefore: DelayMap;
  /** Moves the other player had no live attacker for: these could not lose. */
  safeMoves: Move[];
  /** Rounds won so far, including this one. */
  score: number;
  /** Rounds won before this one — the scoreboard while the verdict waits. */
  scoreBefore: number;
  /** Picks before this round, most recent first — explains the cooldowns. */
  recentMoves: Move[];
  /** The server chose this move because the player ran out of time. */
  autoPicked: boolean;
}

export interface ReplayFrame {
  round: number;
  a: ReplaySide;
  b: ReplaySide;
  /** Winning seatKey, or 'draw'. */
  outcome: string;
  /** The untouched round, for components that already take a `RoundResult`. */
  result: RoundResult;
}

export interface ReplayPlayer {
  seatKey: string;
  playerId: string;
  identity: Identity;
}

export interface Replay {
  frames: ReplayFrame[];
  /** The seat drawn in the blue `--you` role: lowest `position`. */
  a: ReplayPlayer;
  /** The seat drawn in the amber `--opp` role. */
  b: ReplayPlayer;
  bestOf: number;
  winnerSeatKey: string | null;
  endReason: MatchEndReason | null;
  finalScore: { a: number; b: number };
}

/** Seats in board order, so the same player is blue on every load. */
function orderedSeats(state: MatchState): Seat[] {
  return [...state.seats].sort((x, y) => x.position - y.position);
}

/**
 * Why this match cannot be replayed, or null when it can. A replay is only
 * ever of a finished match — a live one would leak the current round's picks.
 */
export function replayBlockedReason(state: MatchState): string | null {
  if (state.match.status !== 'finished') return "This match isn't over yet";
  if (state.results.length === 0) return 'This match has no rounds to replay';
  const seats = orderedSeats(state);
  if (seats.length < 2 || !seats[0].player || !seats[1].player) {
    return 'This match has no rounds to replay';
  }
  return null;
}

export function buildReplay(state: MatchState): Replay {
  const seats = orderedSeats(state);
  const [seatA, seatB] = seats;
  const idA = seatA.player?.id ?? '';
  const idB = seatB.player?.id ?? '';

  let delaysA: DelayMap = { ...INITIAL_DELAYS };
  let delaysB: DelayMap = { ...INITIAL_DELAYS };
  let scoreA = 0;
  let scoreB = 0;
  const playedA: Move[] = [];
  const playedB: Move[] = [];

  const frames: ReplayFrame[] = [];

  for (const result of [...state.results].sort((x, y) => x.round - y.round)) {
    const moveA = result.moves[idA];
    const moveB = result.moves[idB];
    // A round the server recorded without both picks cannot be drawn; skipping
    // it keeps the cooldown chain honest rather than inventing a move.
    if (!moveA || !moveB) continue;

    const beforeA = scoreA;
    const beforeB = scoreB;
    if (result.outcome === seatA.seatKey) scoreA += 1;
    else if (result.outcome === seatB.seatKey) scoreB += 1;

    const autoPicked = result.autoPicked ?? [];

    frames.push({
      round: result.round,
      outcome: result.outcome,
      result,
      a: {
        seatKey: seatA.seatKey,
        playerId: idA,
        move: moveA,
        delaysBefore: delaysA,
        safeMoves: ALL_MOVES.filter((m) => threatsTo(m, delaysB).safe),
        score: scoreA,
        scoreBefore: beforeA,
        recentMoves: [...playedA].reverse(),
        autoPicked: autoPicked.includes(idA),
      },
      b: {
        seatKey: seatB.seatKey,
        playerId: idB,
        move: moveB,
        delaysBefore: delaysB,
        safeMoves: ALL_MOVES.filter((m) => threatsTo(m, delaysA).safe),
        score: scoreB,
        scoreBefore: beforeB,
        recentMoves: [...playedB].reverse(),
        autoPicked: autoPicked.includes(idB),
      },
    });

    delaysA = advanceDelays(delaysA, moveA);
    delaysB = advanceDelays(delaysB, moveB);
    playedA.push(moveA);
    playedB.push(moveB);
  }

  return {
    frames,
    a: { seatKey: seatA.seatKey, playerId: idA, identity: seatIdentity(seatA, 'Player 1') },
    b: { seatKey: seatB.seatKey, playerId: idB, identity: seatIdentity(seatB, 'Player 2') },
    bestOf: state.match.bestOf,
    winnerSeatKey: state.match.winnerSeatKey ?? state.matchWinnerSeatKey,
    endReason: state.match.endReason,
    finalScore: { a: scoreA, b: scoreB },
  };
}

/**
 * The same match seen from the other seat.
 *
 * Seat order normally decides who is drawn in the blue `--you` role, so a
 * player is the same colour every time a replay link is opened. Standing in a
 * player's seat to call their moves is the one thing that should override
 * that: the board's cooldown pills, the reveal card's left-hand side and the
 * end card's verdict all follow the you-side, and they should all follow the
 * player being played as.
 *
 * The recorded `RoundResult` is deliberately left untouched — components find
 * their own side in it by player id, and rewriting it would put the flip in
 * two places at once.
 */
export function flipReplay(replay: Replay): Replay {
  return {
    ...replay,
    a: replay.b,
    b: replay.a,
    frames: replay.frames.map((frame) => ({ ...frame, a: frame.b, b: frame.a })),
    finalScore: { a: replay.finalScore.b, b: replay.finalScore.a },
  };
}
