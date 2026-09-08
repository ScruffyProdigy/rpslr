/**
 * Rebuilding a match's board, round by round, from the record of what was played.
 *
 * The server needs this to answer "what marks does each seat hold right now"; the
 * replay page needs the same thing for every round at once. Before helpers there
 * was no reason for those to be one piece of code — cooldowns were `−1 then +2` and
 * the client could mirror three lines of arithmetic. A loadout ends that: what a
 * move costs, what a draw costs, and which of the *other* player's moves take a
 * mark are all things only the two loadouts together can answer, so a mirror is a
 * second rules engine to keep in step (JQ-207).
 *
 * So this module is the one reconstruction, and both sides call it. It stays pure
 * and free of server types on purpose: `ReconstructionSeat` and `RecordedRound` are
 * the shape of what a match state carries, not the server's own `Seat`, so the
 * frontend can hand over what `GET /api/v1/matches/:ref` gave it without importing
 * anything that knows about express or pg.
 */

import { replayMatch, type DelayMap, type Firing, type Move, type PlayedRound, type PlayerRules } from './game.js';
import type { Loadout } from './helpers/loadout.js';
import { rulesFor } from './helpers/rules.js';

/** What a seat brought to the match — all the rules themselves depend on. */
export interface SeatLoadout {
  /** Null in `duel`, which is the null loadout rather than a special case. */
  loadout: Loadout | null;
  /** The roll stored when the match began; a replay must not throw a fresh one. */
  loadoutRoll: Move | null;
}

/** One seat, reduced to what the arithmetic needs from it. */
export interface ReconstructionSeat extends SeatLoadout {
  seatKey: string;
  playerId: string;
}

/** A resolved round, as `MatchState.results` records it. */
export interface RecordedRound {
  round: number;
  moves: Record<string, Move>;
}

/** An ability spent in a resolved round, as `MatchState.abilityFirings` records it. */
export interface RecordedFiring {
  round: number;
  seatKey: string;
  helperId: string;
  target: Move | null;
  /**
   * Thief's own-side move — the mark it lifts. Null for every other ability.
   *
   * Carried for the same reason `target` is: `fireEffects` refuses a Thief firing
   * that names no source, so dropping it here would not make Thief approximate, it
   * would make Thief do nothing at all.
   */
  source: Move | null;
}

/** The rules each seat plays by, in seat order. */
export function rulesForSeats(a: SeatLoadout, b: SeatLoadout): [PlayerRules, PlayerRules] {
  return [
    rulesFor(a.loadout, { roll: a.loadoutRoll }),
    rulesFor(b.loadout, { roll: b.loadoutRoll }),
  ];
}

/**
 * Why these two seats cannot be reconstructed, or null when they can.
 *
 * The one way that happens is a loadout whose two helpers bind the same move: the
 * cheaper one's marks were displaced by a roll, and without the stored roll there
 * is no way back to the board the match actually opened on. Rendering a plausible
 * one instead would be exactly the confidently-wrong replay this module exists to
 * prevent, so it is refused instead.
 */
export function reconstructionBlockedReason(a: SeatLoadout, b: SeatLoadout): string | null {
  try {
    rulesForSeats(a, b);
    return null;
  } catch {
    return "This match's helper setup can't be reconstructed";
  }
}

/**
 * The rounds as the engine takes them: both picks, plus what each seat fired.
 *
 * Firing is the one input a replay cannot derive — it is a choice, not a
 * consequence of the moves — so it travels with the round or is lost. Everything
 * else here is bookkeeping: sort by round, put each seat's move on its own side,
 * and drop a round the server somehow recorded without both picks rather than
 * inventing one and breaking the chain from there on.
 */
export function playedRoundsFrom(
  results: readonly RecordedRound[],
  firings: readonly RecordedFiring[],
  a: ReconstructionSeat,
  b: ReconstructionSeat,
): PlayedRound[] {
  return [...results]
    .sort((x, y) => x.round - y.round)
    .flatMap((r) => {
      const movedA = r.moves[a.playerId];
      const movedB = r.moves[b.playerId];
      if (!movedA || !movedB) return [];
      return [
        {
          a: movedA,
          b: movedB,
          firedA: firedIn(firings, r.round, a.seatKey),
          firedB: firedIn(firings, r.round, b.seatKey),
        },
      ];
    });
}

/**
 * One seat's firings in one round, as the engine takes them.
 *
 * Exported because the live round needs the same mapping the replay does: the round
 * being resolved reads its firings here, and every earlier round reads them through
 * `playedRoundsFrom`. Two spellings of "what did this seat fire" is how the board a
 * player is shown drifts from the board they played on.
 */
export function firedIn(
  firings: readonly RecordedFiring[],
  round: number,
  seatKey: string,
): Firing[] {
  return firings
    .filter((f) => f.round === round && f.seatKey === seatKey)
    .map((f) => ({
      id: f.helperId,
      target: f.target ?? undefined,
      source: f.source ?? undefined,
    }));
}

/** Both seats' marks at one moment in a match. */
export interface Board {
  a: DelayMap;
  b: DelayMap;
}

/**
 * Every board the match stood on: one per round, as that round was entered, and a
 * last one for the marks it ended holding. `boards[i]` is what the players saw
 * choosing round `i + 1`; `boards.at(-1)` is where a live match stands now.
 *
 * Each is the engine's own `replayMatch` over a prefix rather than a step this
 * module takes itself, so there is no second implementation of the round to drift
 * — the whole point of the exercise. A match is a handful of rounds long, so
 * re-walking each prefix costs nothing worth optimising away.
 */
export function boardsThroughMatch(
  rounds: readonly PlayedRound[],
  rulesA: PlayerRules,
  rulesB: PlayerRules,
): Board[] {
  return Array.from({ length: rounds.length + 1 }, (_, i) =>
    replayMatch(rounds.slice(0, i), rulesA, rulesB),
  );
}
