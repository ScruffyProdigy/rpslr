/**
 * Which tiers may carry a charge — asserted against `tsc`, not against a runtime
 * check.
 *
 * JQ-237 moved the rule: tier sets the price, load sets itself, and only a
 * `Trinket` is still passive by construction. That is a fact about `HelperDef`'s
 * conditional half, so the only honest place to assert it is the type checker.
 * `npm run typecheck` compiles this file; `vitest` runs the runtime cases below so
 * the file is not an empty suite.
 *
 * The cards here are fixtures and nothing else. No shipping card is a charged
 * Minor yet — JQ-236 is the first candidate and is still undecided — so a stand-in
 * is the difference between "this works" and "this compiles".
 */

import { describe, expect, it } from 'vitest';
import { MARK_COST, isAbility, type HelperDef } from './roster.js';

/**
 * Compiles only when `T` is `true`, so a broken rule below is a `tsc` failure
 * rather than a passing test.
 *
 * Written as type-level assertions rather than as `@ts-expect-error` on a
 * miswritten card: an object literal reports its error on the offending *property*,
 * several lines below the directive, where the directive cannot reach it.
 */
type Assert<T extends true> = T;

/** The change itself: `Minor` reaches the charged branch of the union. */
type _MinorMayCarryACharge = Assert<
  'ability' extends HelperDef<'Minor'>['load']['kind'] ? true : false
>;

/** And is not forced into it — most Minors stay passive. */
type _MinorMayStayPassive = Assert<
  'passive' extends HelperDef<'Minor'>['load']['kind'] ? true : false
>;

/**
 * The rule that did not move. A Trinket has no bound move and costs nothing, so a
 * charge on one would be an ability for free.
 */
type _TrinketIsPassiveOnly = Assert<
  HelperDef<'Trinket'>['load']['kind'] extends 'passive' ? true : false
>;

/** A Major is unchanged, which AC #6 turns on. */
type _MajorMayCarryACharge = Assert<
  'ability' extends HelperDef<'Major'>['load']['kind'] ? true : false
>;

/**
 * A Minor that fires. The point of the ticket: it costs the Minor mark price and
 * carries a charge slot priced independently of it.
 */
const WHETSTONE = {
  id: 'whetstone',
  name: 'Whetstone',
  tier: 'Minor',
  boundMove: 'robot',
  load: { kind: 'ability', opening: 0, recharge: 2 },
  reveal: 'public',
  blurb: 'A fixture, not a card. Exists to prove a Minor may fire at all.',
} as const satisfies HelperDef<'Minor'>;

/** A Minor with no charge still type-checks: the load is permitted, not required. */
const PLAIN_MINOR = {
  id: 'plain-minor',
  name: 'Plain Minor',
  tier: 'Minor',
  boundMove: 'paper',
  load: { kind: 'passive' },
  blurb: 'A fixture. A Minor that stayed passive, which most of them are.',
} as const satisfies HelperDef<'Minor'>;

describe('a Minor may carry a charge', () => {
  it('prices the charge slot independently of the tier mark cost', () => {
    // Mark cost 1, opening 0, recharge 2 — three different numbers on one card.
    // That they differ at all is the assertion: the slot is not derived from the
    // price, so a Minor buys a cheaper opening without buying a cheaper charge.
    expect(MARK_COST[WHETSTONE.tier]).toBe(1);
    if (!isAbility(WHETSTONE.load)) throw new Error('the fixture is charged');
    expect(WHETSTONE.load).toEqual({ kind: 'ability', opening: 0, recharge: 2 });
  });

  it('leaves an uncharged Minor passive', () => {
    expect(isAbility(PLAIN_MINOR.load)).toBe(false);
  });
});
