import { describe, expect, it } from 'vitest';
import { INITIAL_DELAYS, MOVES, type DelayMap } from './game.js';
import {
  DUEL_POLICY,
  chooseAutoPick,
  decidePenalty,
  deadlineFor,
  policyForMode,
} from './roundPolicy.js';

/** A delay map with every listed move blocked and the rest live. */
function delaysWith(blocked: Partial<DelayMap>): DelayMap {
  const base = Object.fromEntries(MOVES.map((m) => [m, 0])) as DelayMap;
  return { ...base, ...blocked };
}

describe('policyForMode', () => {
  it('gives duel and duel-helpers the same policy', () => {
    // The mode does not exist yet (see the Helpers mode design doc); the point
    // is that when it lands it inherits this policy rather than defining one.
    expect(policyForMode('duel-helpers')).toBe(policyForMode('duel'));
  });

  it('falls back to the duel policy for an unknown mode', () => {
    expect(policyForMode('mode-that-does-not-exist')).toBe(DUEL_POLICY);
  });
});

describe('allowanceMs', () => {
  it('gives round 1 a longer allowance than later rounds', () => {
    const p = policyForMode('duel');
    expect(p.allowanceMs('pick', 1)).toBe(45_000);
    expect(p.allowanceMs('pick', 2)).toBe(23_200);
    expect(p.allowanceMs('pick', 5)).toBe(23_200);
  });

  it('buys back the reveal hold on every round that has one', () => {
    // 20s of thinking time plus the 3.2s the client spends replaying the last
    // round with the picker inert. Round 1 has no preceding round to replay.
    const p = policyForMode('duel');
    expect(p.allowanceMs('pick', 2) - p.allowanceMs('pick', 1)).toBe(-21_800);
    expect(p.allowanceMs('pick', 2)).toBe(20_000 + 3_200);
  });

  it('treats every round after the first identically', () => {
    const p = policyForMode('duel');
    const later = [2, 3, 4, 5, 9].map((r) => p.allowanceMs('pick', r));
    expect(new Set(later).size).toBe(1);
  });

  it('gives the sub-phase a shorter, round-independent allowance', () => {
    // One narrow decision, taken with whatever opened the window already in hand,
    // and everyone not entitled is locked in and waiting through every second of
    // it. Neither of the pick allowances' two adjustments applies here — there is
    // no first-round reading to do and no reveal animation to sit through.
    const p = policyForMode('duel-helpers');
    for (const round of [1, 2, 5, 9]) expect(p.allowanceMs('react', round)).toBe(12_000);
    expect(p.allowanceMs('react', 2)).toBeLessThan(p.allowanceMs('pick', 2));
  });
});

describe('deadlineFor', () => {
  it('is the phase start plus that phase allowance', () => {
    const p = policyForMode('duel');
    expect(deadlineFor(p, 'pick', 1, 1_000)).toBe(46_000);
    expect(deadlineFor(p, 'pick', 3, 1_000)).toBe(24_200);
  });
});

describe('chooseAutoPick', () => {
  it('only ever picks a move that is live', () => {
    const delays = delaysWith({ lizard: 1, robot: 2 });
    // Sweep the whole unit interval; nothing may select a blocked move.
    for (let i = 0; i < 100; i++) {
      const picked = chooseAutoPick(delays, () => i / 100);
      expect(delays[picked]).toBe(0);
    }
  });

  it('spreads uniformly across the live moves', () => {
    const delays = delaysWith({ lizard: 1, robot: 2 }); // rock, paper, scissors live
    expect(chooseAutoPick(delays, () => 0)).toBe('rock');
    expect(chooseAutoPick(delays, () => 0.5)).toBe('paper');
    expect(chooseAutoPick(delays, () => 0.99)).toBe('scissors');
  });

  it('never runs off the end when rng returns 1', () => {
    const delays = delaysWith({ lizard: 1, robot: 2 });
    expect(MOVES).toContain(chooseAutoPick(delays, () => 1));
  });

  it('works from the opening position', () => {
    const picked = chooseAutoPick({ ...INITIAL_DELAYS }, () => 0.9);
    expect(INITIAL_DELAYS[picked]).toBe(0);
  });

  it('falls back to the least-blocked move if nothing is live', () => {
    // Not reachable in duel (at most two moves carry marks), but a future mode
    // that blocks more must not crash the expiry path.
    const picked = chooseAutoPick(delaysWith({ rock: 3, paper: 1, scissors: 2, lizard: 4, robot: 5 }), () => 0);
    expect(picked).toBe('paper');
  });
});

describe('decidePenalty', () => {
  const p = policyForMode('duel');
  const base = { policy: p, now: 100_000, deadline: 200_000, hasMoved: false, strikes: 0, disconnectedSince: null };

  it('does nothing before the deadline', () => {
    expect(decidePenalty(base)).toEqual({ kind: 'none' });
  });

  it('does nothing when the player has already moved', () => {
    expect(decidePenalty({ ...base, now: 300_000, hasMoved: true })).toEqual({ kind: 'none' });
  });

  it('does nothing when there is no deadline set', () => {
    expect(decidePenalty({ ...base, deadline: null, now: 300_000 })).toEqual({ kind: 'none' });
  });

  it('auto-picks on the first expiry', () => {
    expect(decidePenalty({ ...base, now: 200_001 })).toEqual({ kind: 'auto-pick' });
  });

  it('forfeits on the second consecutive expiry', () => {
    expect(decidePenalty({ ...base, now: 200_001, strikes: 1 })).toEqual({
      kind: 'forfeit',
      reason: 'strikes',
    });
  });

  it('fires exactly at the deadline, not a millisecond later', () => {
    expect(decidePenalty({ ...base, now: 200_000 })).toEqual({ kind: 'auto-pick' });
  });

  it('forfeits a player who has been gone longer than the grace period', () => {
    // Well inside the round deadline — being absent is not the same as being slow.
    expect(
      decidePenalty({ ...base, now: 100_000, disconnectedSince: 100_000 - 45_001 }),
    ).toEqual({ kind: 'forfeit', reason: 'disconnect' });
  });

  it('leaves a briefly-disconnected player alone', () => {
    expect(decidePenalty({ ...base, disconnectedSince: 100_000 - 10_000 })).toEqual({
      kind: 'none',
    });
  });

  it('does not forfeit a disconnected player who already locked in', () => {
    // Their move is in; dropping afterwards costs them nothing.
    expect(
      decidePenalty({
        ...base,
        hasMoved: true,
        disconnectedSince: 100_000 - 45_001,
      }),
    ).toEqual({ kind: 'none' });
  });

  it('prefers the disconnect reason when both triggers are live', () => {
    expect(
      decidePenalty({ ...base, now: 300_000, disconnectedSince: 300_000 - 45_001 }),
    ).toEqual({ kind: 'forfeit', reason: 'disconnect' });
  });
});
