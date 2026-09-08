import type { MatchEndReason, MatchState, Move, RoundResult, Seat } from './api';
import { seatIdentity, type Identity } from './lib/seatProfile';
import { ALL_MOVES, threatsTo } from './moves';
import {
  boardsThroughMatch,
  playedRoundsFrom,
  reconstructionBlockedReason,
  rulesForSeats,
  type Board,
  type ReconstructionSeat,
} from '@game/replayBoard';
import type { DelayMap } from '@game/game';

/**
 * Rebuilding a finished match, round by round, from nothing but what
 * `GET /api/v1/matches/:ref` already returns.
 *
 * `results[]` records what was played and who took each round, but not the
 * cooldown state a round was played *into* — that is never stored, because in
 * a live match it is just the current seat state. It does not need to be:
 * the board is a pure function of the move sequence, the abilities spent in it
 * and the two loadouts, all three of which the state carries.
 *
 * The arithmetic itself is the server's, imported rather than mirrored. It used
 * to be copied here, back when a pick always cost 2 and every match opened on
 * lizard 1 / robot 2 — three lines are cheap to keep in step. A loadout ends
 * that: Ferrus, Featherweight, Tempered, Copycat and Bookend change what a move
 * costs, Quarantine, Rust, Thief, Grudge, Echo Chamber and Small Mercy change
 * the *other* player's marks, and Freeze stops marks coming off at all. Mirrored,
 * that is a second rules engine, and a replay drawn from it would be a board that
 * never existed (JQ-207).
 */

export type { DelayMap };

/** One player's standing at one round, as they entered it. */
export interface ReplaySide {
  seatKey: string;
  playerId: string;
  move: Move;
  /** Marks held entering the round — before this round's pick is charged. */
  delaysBefore: DelayMap;
  /** Marks held leaving it, which is what the next round was entered on. */
  delaysAfter: DelayMap;
  /**
   * Marks this player's loadout opened the match on — duel's lizard 1, robot 2,
   * or wherever this loadout's two cards are bound. Read to tell an opening lock
   * apart from a mark something else put there.
   */
  openingDelays: DelayMap;
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
  /**
   * True once either seat brought helpers. The commentary reads it before saying
   * anything that is only true of a plain duel — what a pick costs, which moves
   * start locked — rather than asserting the duel numbers at a helpers match.
   */
  hasLoadouts: boolean;
}

/** Seats in board order, so the same player is blue on every load. */
function orderedSeats(state: MatchState): Seat[] {
  return [...state.seats].sort((x, y) => x.position - y.position);
}

/** A claimed seat as the shared reconstruction wants it. */
function reconstructionSeat(seat: Seat): ReconstructionSeat {
  return {
    seatKey: seat.seatKey,
    playerId: seat.player?.id ?? '',
    loadout: seat.loadout ?? null,
    loadoutRoll: seat.loadoutRoll ?? null,
  };
}

/**
 * Why this match cannot be replayed, or null when it can. A replay is only
 * ever of a finished match — a live one would leak the current round's picks.
 *
 * A helpers match adds one more way to be unreplayable: a loadout whose two cards
 * bound the same move was settled by a roll, and without the stored roll there is
 * no route back to the board it opened on. Saying so is the honest answer; drawing
 * a plausible board instead is the failure this whole module exists to avoid.
 */
export function replayBlockedReason(state: MatchState): string | null {
  if (state.match.status !== 'finished') return "This match isn't over yet";
  if (state.results.length === 0) return 'This match has no rounds to replay';
  const seats = orderedSeats(state);
  if (seats.length < 2 || !seats[0].player || !seats[1].player) {
    return 'This match has no rounds to replay';
  }
  return reconstructionBlockedReason(seats[0], seats[1]);
}

export function buildReplay(state: MatchState): Replay {
  const seats = orderedSeats(state);
  const [seatA, seatB] = seats;
  const a = reconstructionSeat(seatA);
  const b = reconstructionSeat(seatB);

  const rounds = playedRoundsFrom(state.results, state.abilityFirings ?? [], a, b);
  const boards = boardsThroughMatch(rounds, ...rulesForSeats(seatA, seatB));
  const [opening] = boards;

  // The rounds the boards were built from, in the same order, so a round the
  // reconstruction discarded for want of a pick is discarded from the strip too
  // rather than shifting every board after it onto the wrong round.
  const played = [...state.results]
    .sort((x, y) => x.round - y.round)
    .filter((r) => r.moves[a.playerId] && r.moves[b.playerId]);

  let scoreA = 0;
  let scoreB = 0;
  const playedA: Move[] = [];
  const playedB: Move[] = [];

  const frames: ReplayFrame[] = played.map((result, index) => {
    const moveA = result.moves[a.playerId];
    const moveB = result.moves[b.playerId];
    const before: Board = boards[index];
    const after: Board = boards[index + 1];

    const beforeA = scoreA;
    const beforeB = scoreB;
    if (result.outcome === seatA.seatKey) scoreA += 1;
    else if (result.outcome === seatB.seatKey) scoreB += 1;

    const autoPicked = result.autoPicked ?? [];
    const frame: ReplayFrame = {
      round: result.round,
      outcome: result.outcome,
      result,
      a: {
        seatKey: seatA.seatKey,
        playerId: a.playerId,
        move: moveA,
        delaysBefore: before.a,
        delaysAfter: after.a,
        openingDelays: opening.a,
        safeMoves: ALL_MOVES.filter((m) => threatsTo(m, before.b).safe),
        score: scoreA,
        scoreBefore: beforeA,
        recentMoves: [...playedA].reverse(),
        autoPicked: autoPicked.includes(a.playerId),
      },
      b: {
        seatKey: seatB.seatKey,
        playerId: b.playerId,
        move: moveB,
        delaysBefore: before.b,
        delaysAfter: after.b,
        openingDelays: opening.b,
        safeMoves: ALL_MOVES.filter((m) => threatsTo(m, before.a).safe),
        score: scoreB,
        scoreBefore: beforeB,
        recentMoves: [...playedB].reverse(),
        autoPicked: autoPicked.includes(b.playerId),
      },
    };

    playedA.push(moveA);
    playedB.push(moveB);
    return frame;
  });

  return {
    frames,
    a: { seatKey: seatA.seatKey, playerId: a.playerId, identity: seatIdentity(seatA, 'Player 1') },
    b: { seatKey: seatB.seatKey, playerId: b.playerId, identity: seatIdentity(seatB, 'Player 2') },
    bestOf: state.match.bestOf,
    winnerSeatKey: state.match.winnerSeatKey ?? state.matchWinnerSeatKey,
    endReason: state.match.endReason,
    finalScore: { a: scoreA, b: scoreB },
    hasLoadouts: Boolean(a.loadout || b.loadout),
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
