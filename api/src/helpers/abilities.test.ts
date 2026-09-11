/**
 * The ability cooldown track: what a loadout's charges stand at after a given
 * sequence of firings.
 *
 * Kept apart from `rules.test.ts` because that file is about what a card does to a
 * round, and this one is about when it may do it at all.
 */

import { describe, expect, it } from 'vitest';
import { abilityMarks, chargesNow, slotMarks } from './abilities.js';
import { getHelper } from './roster.js';
import type { Loadout } from './loadout.js';

const load = (a: string, b: string) => [a, b] as unknown as Loadout;

/**
 * A card's clock, read off the roster rather than restated (JQ-256).
 *
 * Every number below that belongs to a shipping card comes through here. What
 * stays written out is the *shape* of the rule — that an opening of 0 is
 * available and anything higher is not — because that is what this file is
 * about, and a reprice is not a change to it.
 */
function clock(id: string): { opening: number; recharge: number | null } {
  const { load } = getHelper(id)!;
  if (load.kind !== 'ability') throw new Error(`${id} carries no charge to read`);
  return { opening: load.opening, recharge: load.recharge };
}

/** The empty firing rows a run of `n` rounds with nothing fired looks like. */
const quietRounds = (n: number) => Array.from({ length: n }, () => []);

describe('abilityMarks', () => {
  it('opens on the marks the roster declares', () => {
    // The pairing is chosen so both sides of the rule are exercised at once —
    // one card that opens charged and one that does not. That premise is pinned
    // here rather than assumed, so a reprice that collapses it says so.
    const sacrifice = clock('sacrifice');
    const quarantine = clock('quarantine');
    expect(sacrifice.opening).toBeGreaterThan(0);
    expect(quarantine.opening).toBe(0);

    expect(abilityMarks(load('sacrifice', 'quarantine'), [])).toEqual({
      sacrifice: { marks: sacrifice.opening, available: false },
      quarantine: { marks: quarantine.opening, available: true },
    });
  });
});

describe('abilityMarks counts down like a move does', () => {
  it('becomes available on the round its opening marks name', () => {
    // However many marks Sacrifice opens on, it is back on exactly that many
    // quiet rounds — the claim is the count, not the current number.
    const { opening } = clock('sacrifice');
    const after = abilityMarks(load('sacrifice', 'poker-face'), quietRounds(opening));
    expect(after).toEqual({ sacrifice: { marks: 0, available: true } });
  });

  it('floors at zero rather than going negative', () => {
    const { opening } = clock('sacrifice');
    const overshot = abilityMarks(load('sacrifice', 'poker-face'), quietRounds(opening + 3));
    expect(overshot).toEqual({ sacrifice: { marks: 0, available: true } });
  });

  it('charges the recharge marks when it fires', () => {
    // Decrement first, then the firing's cost, exactly as a chosen move is charged.
    // Quarantine opens on nothing, so the decrement has nothing to take and what
    // is left standing is the recharge itself.
    const { opening, recharge } = clock('quarantine');
    expect(opening).toBe(0);
    const after = abilityMarks(load('quarantine', 'poker-face'), [[{ id: 'quarantine' }]]);
    expect(after).toEqual({ quarantine: { marks: recharge, available: false } });
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

describe('chargesNow', () => {
  const loadout = load('freeze', 'poker-face');

  it('opens on a charged card, which is what the rest of this block assumes', () => {
    expect(clock('freeze').opening).toBe(0);
  });

  it('reads the resolved fold when nothing is pending', () => {
    expect(chargesNow(loadout, [[]])).toEqual({ freeze: { marks: 0, available: true } });
  });

  it('marks a charge spent in the round being played without moving its arithmetic', () => {
    // The recharge lands when the round resolves, so `marks` is untouched — only
    // the offer is withdrawn.
    expect(chargesNow(loadout, [[]], [{ id: 'freeze' }])).toEqual({
      freeze: { marks: 0, available: false },
    });
  });

  it('leaves a pending firing this loadout does not hold to the caller to reject', () => {
    expect(chargesNow(loadout, [[]], [{ id: 'rust' }])).toEqual({
      freeze: { marks: 0, available: true },
    });
  });

  it('cannot make an uncharged ability look any more spent than it is', () => {
    // Fired on the opening round: still its full opening out, still unavailable.
    const { opening } = clock('sacrifice');
    expect(chargesNow(load('sacrifice', 'poker-face'), [], [{ id: 'sacrifice' }])).toEqual({
      sacrifice: { marks: opening, available: false },
    });
  });
});
