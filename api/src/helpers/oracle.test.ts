import { describe, expect, it } from 'vitest';
import { MOVES, type DelayMap, type Move } from '../game.js';
import { nameUnplayedMove } from './oracle.js';

const clear = (): DelayMap => Object.fromEntries(MOVES.map((m) => [m, 0])) as DelayMap;
const withMarks = (marks: Partial<Record<Move, number>>): DelayMap => ({ ...clear(), ...marks });

/** Deterministic rng returning a fixed sequence, then 0. */
const feed = (...values: number[]) => {
  let i = 0;
  return () => values[i++] ?? 0;
};

describe('nameUnplayedMove', () => {
  it('never names the move they actually played', () => {
    // Every draw across the whole [0,1) range, so the exclusion cannot be a
    // lucky roll: the played move must be unreachable, not merely unlikely.
    for (let r = 0; r < 1; r += 0.01) {
      expect(nameUnplayedMove(clear(), 'rock', () => r)).not.toBe('rock');
    }
  });

  it('names only moves they could actually have played', () => {
    // Rock and paper are the only live ones, so a named lizard would be telling
    // the holder something false — it was never a candidate to begin with.
    const delays = withMarks({ scissors: 2, lizard: 1, robot: 3 });
    for (let r = 0; r < 1; r += 0.01) {
      expect(nameUnplayedMove(delays, 'rock', () => r)).toBe('paper');
    }
  });

  it('draws uniformly across the candidates', () => {
    // Four candidates once rock is excluded; the four quarters of the range map
    // to them in order, which is what "uniformly at random" has to mean here.
    const draws = [0, 0.3, 0.5, 0.8].map((r) => nameUnplayedMove(clear(), 'rock', () => r));
    expect(draws).toEqual(['paper', 'scissors', 'lizard', 'robot']);
  });

  it('handles rng() === 1 without running off the end', () => {
    expect(nameUnplayedMove(clear(), 'rock', () => 1)).toBe('robot');
  });

  it('names nothing when the only live move is the one they played', () => {
    // They had no choice, so there is no move they "did not play" to name. The
    // holder learns nothing — but the public delays already told them that.
    const delays = withMarks({ paper: 2, scissors: 2, lizard: 2, robot: 2 });
    expect(nameUnplayedMove(delays, 'rock', feed(0))).toBeNull();
  });

  it('reads liveness through the cooldown floor, not through a zero-mark test', () => {
    // Every move is marked, so `availableMoves` falls back to the least-marked
    // ones. Those are exactly what the opponent could have played, so those are
    // exactly what Oracle may name.
    const delays = withMarks({ rock: 1, paper: 1, scissors: 3, lizard: 3, robot: 3 });
    for (let r = 0; r < 1; r += 0.01) {
      expect(nameUnplayedMove(delays, 'rock', () => r)).toBe('paper');
    }
  });
});
