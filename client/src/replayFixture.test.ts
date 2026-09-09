import { describe, expect, it } from 'vitest';
import type { DelayMap } from '@game/game';
import type { MatchState } from './api';
import { buildReplay } from './replay';

/**
 * The reconstruction, checked against the server that produced it.
 *
 * Every other test here builds its own match state, so it can only ever prove the
 * replay agrees with the test's idea of the rules. This one replays a `duel-helpers`
 * match a real `GameService` actually played, and compares each round's rebuilt board
 * against the marks the server itself was holding when that round was chosen. If the
 * two rules engines ever part company, this is where it shows (JQ-207).
 *
 * Regenerate the fixture from the api package with `npm run golden:helpers-replay`.
 */
interface Fixture {
  state: MatchState;
  boards: { round: number; delays: Record<string, DelayMap> }[];
}

import recorded from '../../docs/fixtures/replay/duel-helpers.json';

const fixture = recorded as unknown as Fixture;

describe('replaying a recorded duel-helpers match', () => {
  const replay = buildReplay(fixture.state);

  it('is a match no duel could have produced', () => {
    // Otherwise the comparison below would pass on the old fixed constants and
    // prove nothing. Grudge and Echo Chamber bind Scissors and Paper; a duel opens
    // on Lizard and Robot and never on these.
    expect(replay.hasLoadouts).toBe(true);
    expect(fixture.boards[0].delays['1']).not.toEqual({
      rock: 0,
      paper: 0,
      scissors: 0,
      lizard: 1,
      robot: 2,
    });
  });

  it('rebuilds every round the server played', () => {
    expect(replay.frames.map((f) => f.round)).toEqual(fixture.boards.map((b) => b.round));
  });

  it('rebuilds the board each round was actually chosen against', () => {
    for (const [i, frame] of replay.frames.entries()) {
      const recorded = fixture.boards[i].delays;
      expect({ round: frame.round, a: frame.a.delaysBefore, b: frame.b.delaysBefore }).toEqual({
        round: fixture.boards[i].round,
        a: recorded[frame.a.seatKey],
        b: recorded[frame.b.seatKey],
      });
    }
  });

  it('shows the marks one player helpers put on the other player board', () => {
    // Round 3 is entered after seat 1 lost round 2 holding both Grudge and Small
    // Mercy, so the Scissors that beat them carries their two extra marks on top
    // of what the pick itself cost — a board a per-seat replay cannot reach.
    const enteringRoundThree = replay.frames[2];
    expect(enteringRoundThree.b.delaysBefore.scissors).toBe(4);
  });
});
