/**
 * The ability cooldown track: what a loadout's charges stand at after a given
 * sequence of firings.
 *
 * Kept apart from `rules.test.ts` because that file is about what a card does to a
 * round, and this one is about when it may do it at all.
 */

import { describe, expect, it } from 'vitest';
import { abilityMarks, slotMarks } from './abilities.js';
import type { Loadout } from './loadout.js';

const load = (a: string, b: string) => [a, b] as unknown as Loadout;

describe('abilityMarks', () => {
  it('opens on the marks the roster declares', () => {
    expect(abilityMarks(load('sacrifice', 'quarantine'), [])).toEqual({
      sacrifice: { marks: 3, available: false },
      quarantine: { marks: 0, available: true },
    });
  });
});

describe('abilityMarks counts down like a move does', () => {
  it('becomes available on the round its opening marks name', () => {
    // Sacrifice opens on 3, so it does nothing until round 4.
    const after3 = abilityMarks(load('sacrifice', 'poker-face'), [[], [], []]);
    expect(after3).toEqual({ sacrifice: { marks: 0, available: true } });
  });

  it('floors at zero rather than going negative', () => {
    const after6 = abilityMarks(load('sacrifice', 'poker-face'), [[], [], [], [], [], []]);
    expect(after6).toEqual({ sacrifice: { marks: 0, available: true } });
  });

  it('charges the recharge marks when it fires', () => {
    // Decrement first, then the firing's cost, exactly as a chosen move is charged.
    const after = abilityMarks(load('quarantine', 'poker-face'), [[{ id: 'quarantine' }]]);
    expect(after).toEqual({ quarantine: { marks: 3, available: false } });
  });
});

describe('an ability that never recharges', () => {
  const relic = { relic: { opening: 0, recharge: null } };

  it('is spent for the match once fired', () => {
    expect(slotMarks(relic, [[{ id: 'relic' }]])).toEqual({
      relic: { marks: null, available: false },
    });
  });

  it('does not come back however many rounds pass', () => {
    expect(slotMarks(relic, [[{ id: 'relic' }], [], [], [], [], []])).toEqual({
      relic: { marks: null, available: false },
    });
  });
});
