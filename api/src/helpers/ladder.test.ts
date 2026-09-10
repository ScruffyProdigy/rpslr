/**
 * The tier ladder is what makes free-form drafting survivable: with no slot rule,
 * a mispriced card is the single biggest risk, and it shows up as a loadout that
 * opens with more live moves than its price should buy.
 *
 * A failure here names the exact pairing. That is the point — it is a pricing bug
 * to take to Ryan, not a test to loosen.
 */

import { describe, expect, it } from 'vitest';
import { HELPERS, MARK_COST } from './roster.js';
import { openingMarks, type Loadout } from './loadout.js';
import { abilityMarks, slotsFor } from './abilities.js';
import { rollFor, rulesFor } from './rules.js';
import { availableMoves, MOVES, replayMatch, type Move } from '../game.js';

const PAIRS = HELPERS.flatMap((a, i) => HELPERS.slice(i + 1).map((b) => [a, b] as const));

/** Deterministic stand-in for the uniform roll, so a failure is reproducible. */
const first = (candidates: Move[]) => candidates[0];

const TIER_ORDER = ['Major', 'Minor', 'Trinket'];
const shapeOf = (a: string, b: string) =>
  [a, b].sort((x, y) => TIER_ORDER.indexOf(x) - TIER_ORDER.indexOf(y)).join('+');

describe('the tier ladder holds for every legal loadout', () => {
  it('has 231 loadouts', () => {
    // C(21, 2). Was 231 at 22 helpers, before Blind Spot was cut.
    // 22 helpers taken two at a time. Was 210 at 21, before JQ-209 added Well Oiled.
    expect(PAIRS).toHaveLength(231);
  });

  it('blocks exactly one move per bound helper, whatever they are bound to', () => {
    for (const [a, b] of PAIRS) {
      const boundCount = [a, b].filter((h) => h.boundMove !== null).length;
      const { delays } = openingMarks([a.id, b.id] as Loadout, first);
      const blocked = Object.values(delays).filter((n) => n > 0).length;
      expect(blocked, `${a.id} + ${b.id}`).toBe(boundCount);
    }
  });

  it('spends exactly the loadout price in marks', () => {
    for (const [a, b] of PAIRS) {
      const price = MARK_COST[a.tier] + MARK_COST[b.tier];
      const { delays } = openingMarks([a.id, b.id] as Loadout, first);
      const spent = Object.values(delays).reduce((n, m) => n + m, 0);
      expect(spent, `${a.id} + ${b.id}`).toBe(price);
    }
  });

  it('opens with the live-move count the shape table predicts', () => {
    // Design doc, "The tier ladder does the balancing": live moves entering round 1.
    const expected: Record<string, number> = {
      'Major+Major': 3,
      'Major+Minor': 3,
      'Major+Trinket': 4,
      'Minor+Minor': 3,
      'Minor+Trinket': 4,
      'Trinket+Trinket': 5,
    };
    for (const [a, b] of PAIRS) {
      const shape = shapeOf(a.tier, b.tier);
      const { delays } = openingMarks([a.id, b.id] as Loadout, first);
      expect(availableMoves(delays).length, `${a.id} + ${b.id} (${shape})`).toBe(expected[shape]);
    }
  });

  it('never blocks a move harder than a Major could', () => {
    for (const [a, b] of PAIRS) {
      const { delays } = openingMarks([a.id, b.id] as Loadout, first);
      for (const move of MOVES) {
        expect(delays[move], `${a.id} + ${b.id} on ${move}`).toBeLessThanOrEqual(MARK_COST.Major);
      }
    }
  });

  it('compiles every loadout into rules that replay a match without throwing', () => {
    for (const [a, b] of PAIRS) {
      const loadout = [a.id, b.id] as Loadout;
      const roll = rollFor(loadout, first);
      const rules = rulesFor(loadout, { roll });
      // Play whatever is live, twice, so per-round hooks all get exercised.
      const opening = availableMoves(rules.initialDelays);
      const rounds = [
        { a: opening[0], b: opening[0] },
        { a: opening[1], b: opening[0] },
      ];
      const { a: marksA, b: marksB } = replayMatch(rounds, rules, rulesFor(null));
      for (const move of MOVES) {
        expect(marksA[move], `${a.id} + ${b.id}`).toBeGreaterThanOrEqual(0);
        expect(marksB[move], `${a.id} + ${b.id}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('leaves every loadout at least one move to open with', () => {
    for (const [a, b] of PAIRS) {
      const { delays } = openingMarks([a.id, b.id] as Loadout, first);
      expect(availableMoves(delays).length, `${a.id} + ${b.id}`).toBeGreaterThan(0);
    }
  });

  it('holds for every landing spot the roll could pick, not just the first', () => {
    const colliding = PAIRS.filter(
      ([a, b]) => a.boundMove !== null && a.boundMove === b.boundMove,
    );
    expect(colliding.length).toBeGreaterThan(0);
    for (const [a, b] of colliding) {
      const loadout = [a.id, b.id] as Loadout;
      for (let index = 0; index < 4; index += 1) {
        const { delays } = openingMarks(loadout, (c) => c[Math.min(index, c.length - 1)]);
        const spent = Object.values(delays).reduce((n, m) => n + m, 0);
        expect(spent, `${a.id} + ${b.id} roll ${index}`).toBe(
          MARK_COST[a.tier] + MARK_COST[b.tier],
        );
        expect(
          Object.values(delays).filter((n) => n > 0).length,
          `${a.id} + ${b.id} roll ${index}`,
        ).toBe(2);
      }
    }
  });
});

/**
 * The same sweep, for the ability track.
 *
 * `openingMarks` above is about the marks a loadout puts on *moves*; a Major that
 * carries a charge puts marks on its own slot too, and a mispriced one shows up
 * the same way — as a card that is live when it should not be, or that firing
 * drives somewhere the arithmetic cannot come back from.
 */
describe('the ability track holds for every legal loadout', () => {
  const loadoutOf = (a: string, b: string) => [a, b] as Loadout;
  const quiet = (rounds: number) => Array.from({ length: rounds }, () => []);

  it('makes each ability available exactly on the round its opening marks name', () => {
    for (const [x, y] of PAIRS) {
      const loadout = loadoutOf(x.id, y.id);
      for (const [id, slot] of Object.entries(slotsFor(loadout))) {
        for (let round = 0; round <= slot.opening; round += 1) {
          const state = abilityMarks(loadout, quiet(round))[id];
          expect(state.available, `${x.id} + ${y.id}: ${id} after ${round} rounds`).toBe(
            round === slot.opening,
          );
        }
      }
    }
  });

  /**
   * Three firing disciplines, because they stress different halves of the fold:
   * never firing leaves a slot sitting at zero taking the decrement (which is what
   * the floor is for), firing on sight exercises the recharge, and firing blind
   * exercises what an unvalidated caller can do to it.
   */
  const STRATEGIES = {
    'never fires': () => false,
    'fires the moment it comes up': (available: boolean) => available,
    'fires blind, cooldown or not': () => true,
  };

  for (const [discipline, shouldFire] of Object.entries(STRATEGIES)) {
    it(`never drives an ability below zero when it ${discipline}`, () => {
      for (const [x, y] of PAIRS) {
        const loadout = loadoutOf(x.id, y.id);
        const ids = Object.keys(slotsFor(loadout));
        if (ids.length === 0) continue;

        // Longer than any match runs, so nothing is proved by simply stopping early.
        const firings: { id: string }[][] = [];
        for (let round = 0; round < 12; round += 1) {
          const state = abilityMarks(loadout, firings);
          for (const id of ids) {
            expect(
              state[id].marks ?? 0,
              `${x.id} + ${y.id}: ${id} at round ${round} when it ${discipline}`,
            ).toBeGreaterThanOrEqual(0);
          }
          firings.push(ids.filter((id) => shouldFire(state[id].available)).map((id) => ({ id })));
        }
      }
    });
  }
});
