/**
 * A real `duel-helpers` match, recorded so the frontend can be held to it.
 *
 * The replay page rebuilds every round's board from the finished match's payload
 * alone. Nothing in that payload says what the board *was*, so the only way to
 * know the reconstruction is right is to write down what the server itself held
 * at each round while the match was being played, and check the rebuild against
 * it afterwards (JQ-207).
 *
 * The loadouts are chosen to be the hard case rather than a representative one:
 * Grudge, Small Mercy and Echo Chamber all put marks on the *other* player's
 * moves, which is exactly what a per-seat replay cannot see, and Bookend prices a
 * pick differently from every other round in the match.
 *
 * Regenerate with `npm run golden:helpers-replay`. Unlike `duelGolden.json` this
 * is not a byte-identity guarantee — it carries generated ids and is a sample, not
 * a contract — so re-capturing it after a deliberate rules change is routine.
 */

import { MemoryGameRepository } from '../memoryRepository.js';
import { GameService } from '../service.js';
import type { MatchState } from '../types.js';
import type { DelayMap, Move } from '../game.js';

/** Fixed clock and seeded rng, so a re-capture diffs on rules and not on noise. */
const FIXED_NOW = Date.parse('2026-01-01T00:00:00.000Z');

function seededRng(seed = 42): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** The marks every seat held entering one round, as the server itself had them. */
export interface RecordedBoard {
  /** The round these marks were carried into. */
  round: number;
  delays: Record<string, DelayMap>;
}

export interface HelpersReplayFixture {
  /** What the replay page is handed: the finished match, exactly as served. */
  state: MatchState;
  /** What it has to arrive back at, one entry per round the match played. */
  boards: RecordedBoard[];
}

/**
 * Seat 1 reaches across the table twice (Grudge, Small Mercy); seat 2 reaches
 * across on a draw and pays a different price for its opening pick (Echo Chamber,
 * Bookend). Neither is a duel in any round.
 *
 * Rescripted by JQ-209. Small Mercy is a Minor bound to rock now, so seat 1 opens
 * with rock and scissors both marked and the old round-1 `rock` was not a legal
 * pick. The sequence below is chosen to fire all three cards exactly once: seat 1
 * loses round 1 (Small Mercy), the seats draw round 3 (Echo Chamber), and seat 1
 * loses again in round 4, which is Grudge's — it sits out the first loss since
 * JQ-209, so the fixture now covers the partition between the two cards rather
 * than the stack they used to make.
 */
const SCRIPT: [Move, Move][] = [
  ['paper', 'scissors'],
  ['rock', 'lizard'],
  ['robot', 'robot'],
  ['lizard', 'scissors'],
  ['paper', 'rock'],
];

export async function captureHelpersReplay(): Promise<HelpersReplayFixture> {
  const service = new GameService(new MemoryGameRepository(), {
    now: () => FIXED_NOW,
    rng: seededRng(),
  });
  const created = await service.createStandaloneMatch({
    gameMode: 'duel-helpers',
    name: 'Helpers replay',
    hostName: 'Alice',
    // Best of 3, so the scripted five rounds reach a decision: a replay is only
    // ever of a finished match.
    bestOf: 3,
    seats: [
      { seatKey: '1', options: [{ groupKey: 'helpers', optionIds: ['grudge', 'small-mercy'] }] },
      { seatKey: '2', options: [{ groupKey: 'helpers', optionIds: ['echo-chamber', 'bookend'] }] },
    ],
  });
  const code = created.state.match.code;
  const hostId = created.you.playerId;
  const joined = await service.claimSeat(code, { seatKey: '2', name: 'Bob' });
  const challengerId = joined.you.playerId;

  const boards: RecordedBoard[] = [];
  for (const [a, b] of SCRIPT) {
    // Read *before* the round resolves: these are the marks the two players were
    // choosing against, which is what a replay frame claims to show.
    const entering = await service.getState(code);
    boards.push({
      round: entering.match.currentRound,
      delays: Object.fromEntries(entering.seats.map((s) => [s.seatKey, s.delays as DelayMap])),
    });
    await service.submitMove(code, hostId, a);
    const after = await service.submitMove(code, challengerId, b);
    if (after.match.status === 'finished') break;
  }

  return { state: await service.getState(code), boards };
}
