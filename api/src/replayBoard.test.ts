import { describe, expect, it } from 'vitest';
import { computeDelays, type Move } from './game.js';
import {
  boardsThroughMatch,
  playedRoundsFrom,
  reconstructionBlockedReason,
  rulesForSeats,
  type RecordedFiring,
  type RecordedRound,
  type ReconstructionSeat,
} from './replayBoard.js';

const A: ReconstructionSeat = { seatKey: 'a', playerId: 'pa', loadout: null, loadoutRoll: null };
const B: ReconstructionSeat = { seatKey: 'b', playerId: 'pb', loadout: null, loadoutRoll: null };

function round(n: number, a: Move, b: Move): RecordedRound {
  return { round: n, moves: { pa: a, pb: b } };
}

describe('playedRoundsFrom', () => {
  it('puts each seat moves on its own side of the round, in round order', () => {
    const rounds = playedRoundsFrom([round(2, 'paper', 'rock'), round(1, 'rock', 'paper')], [], A, B);
    expect(rounds).toEqual([
      { a: 'rock', b: 'paper', firedA: [], firedB: [] },
      { a: 'paper', b: 'rock', firedA: [], firedB: [] },
    ]);
  });

  it('hands each seat the abilities that seat fired in that round', () => {
    const firings: RecordedFiring[] = [
      { round: 1, seatKey: 'b', helperId: 'quarantine', target: 'rock', source: null },
      { round: 2, seatKey: 'a', helperId: 'freeze', target: null, source: null },
    ];
    const rounds = playedRoundsFrom([round(1, 'rock', 'paper'), round(2, 'paper', 'rock')], firings, A, B);

    expect(rounds[0].firedA).toEqual([]);
    expect(rounds[0].firedB).toEqual([{ id: 'quarantine', target: 'rock', source: undefined }]);
    expect(rounds[1].firedA).toEqual([{ id: 'freeze', target: undefined, source: undefined }]);
  });

  it("carries Thief's own-side move, which is half of what Thief names", () => {
    // Regression: this mapping dropped `source` while nothing could fire (JQ-220
    // owns that path). `fireEffects` refuses a Thief firing with no source, so the
    // omission would not have made Thief approximate — it would have made Thief
    // inert, silently, in the one place both the live board and the replay read.
    const firings: RecordedFiring[] = [
      { round: 1, seatKey: 'a', helperId: 'thief', target: 'scissors', source: 'lizard' },
    ];
    const rounds = playedRoundsFrom([round(1, 'rock', 'paper')], firings, A, B);
    expect(rounds[0].firedA).toEqual([{ id: 'thief', target: 'scissors', source: 'lizard' }]);
  });

  it('drops a round the server recorded without both picks', () => {
    const half: RecordedRound = { round: 1, moves: { pa: 'rock' } };
    expect(playedRoundsFrom([half], [], A, B)).toEqual([]);
  });
});

describe('boardsThroughMatch', () => {
  const rules = () => rulesForSeats(A, B);

  it('returns one board per round plus the board the match ended on', () => {
    const rounds = playedRoundsFrom([round(1, 'rock', 'paper'), round(2, 'paper', 'rock')], [], A, B);
    expect(boardsThroughMatch(rounds, ...rules())).toHaveLength(3);
  });

  it('opens on the marks a duel has always opened on', () => {
    const [opening] = boardsThroughMatch([], ...rules());
    expect(opening.a).toEqual({ rock: 0, paper: 0, scissors: 0, lizard: 1, robot: 2 });
  });

  it('agrees with the per-seat duel replay at every round', () => {
    const moves: Move[] = ['rock', 'paper', 'scissors', 'lizard'];
    const rounds = playedRoundsFrom(
      moves.map((m, i) => round(i + 1, m, 'robot')),
      [],
      A,
      B,
    );
    const boards = boardsThroughMatch(rounds, ...rules());
    boards.forEach((board, i) => expect(board.a).toEqual(computeDelays(moves.slice(0, i))));
  });

  it('shows a mark one seat helper put on the other seat board', () => {
    // Grudge marks whatever beat its owner, from the second loss on — JQ-209 gave
    // the first loss to Small Mercy. A loses round 1 to Paper and round 2 to
    // Scissors, so Scissors rests a round longer than the pick alone would cost it.
    const grudge: ReconstructionSeat = { ...A, loadout: ['grudge', 'copycat'], loadoutRoll: null };
    const rounds = playedRoundsFrom(
      [round(1, 'rock', 'paper'), round(2, 'lizard', 'scissors')],
      [],
      grudge,
      B,
    );
    const [, afterRoundOne, afterRoundTwo] = boardsThroughMatch(rounds, ...rulesForSeats(grudge, B));

    // Round 1 is the free one: Paper takes the pick's 2 marks and nothing more.
    expect(afterRoundOne.b.paper).toBe(2);
    expect(afterRoundTwo.b.scissors).toBe(3);
  });
});

describe('reconstructionBlockedReason', () => {
  it('passes a pair of seats whose rules can be built', () => {
    expect(reconstructionBlockedReason(A, B)).toBeNull();
  });

  it('refuses a loadout whose same-move collision was never rolled', () => {
    // Grudge and Sharp Practice both bind Scissors, so one was displaced by a
    // roll. Without the stored roll there is no honest board to draw.
    const unrolled: ReconstructionSeat = {
      ...A,
      loadout: ['grudge', 'sharp-practice'],
      loadoutRoll: null,
    };
    expect(reconstructionBlockedReason(unrolled, B)).toBe(
      "This match's helper setup can't be reconstructed",
    );
  });
});
