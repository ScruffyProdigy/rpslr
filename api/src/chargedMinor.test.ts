/**
 * JQ-237: a charged Minor, driven end to end through the real engine.
 *
 * ## Why the roster is faked here
 *
 * No shipping card is a charged Minor. JQ-236 is the first candidate and is still
 * undecided, and this ticket deliberately retiers nothing — so without a stand-in
 * the new half of the type has no card to exercise it, and "a Minor may carry a
 * charge" would be a claim about `tsc` and nothing else. Faking one is the
 * difference between "this works" and "this compiles".
 *
 * Only the roster array is replaced, by appending. Every real card keeps its real
 * tier, binding, marks and validation, so nothing here depends on a shipping card
 * behaving differently than it does in production.
 *
 * ## What the fixture is priced at
 *
 * Whetstone costs 1 mark (the Minor price), opens on 0 and recharges on 2 — three
 * different numbers on one card, on purpose. Tier sets the price and the charge
 * slot sets itself, and a fixture whose numbers coincided would not show that.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const WHETSTONE = {
  id: 'whetstone',
  name: 'Whetstone',
  tier: 'Minor',
  boundMove: 'robot',
  load: { kind: 'ability', opening: 0, recharge: 2 },
  // Secret, so this file exercises the charge and not JQ-239's sub-phase, which
  // `subPhase.test.ts` already owns.
  reveal: 'secret',
  blurb: 'A fixture, not a card. A Minor that fires.',
} as const;

vi.mock('./helpers/roster.js', async () => {
  const actual = await vi.importActual<typeof import('./helpers/roster.js')>('./helpers/roster.js');
  const HELPERS = [...actual.HELPERS, WHETSTONE];
  return {
    ...actual,
    HELPERS,
    getHelper: (id: string) => HELPERS.find((h) => h.id === id),
    isHelperId: (id: string) => HELPERS.some((h) => h.id === id),
  };
});

const { helpersIn, loadoutPrice, openingMarks, uniformPicker } = await import(
  './helpers/loadout.js'
);
const { abilityMarks, chargesNow, slotsFor } = await import('./helpers/abilities.js');
const { MARK_COST } = await import('./helpers/roster.js');
const { MemoryGameRepository } = await import('./memoryRepository.js');
const { GameService } = await import('./service.js');

// Type-only, so it needs no runtime import and is unaffected by the mock above.
type Loadout = import('./helpers/loadout.js').Loadout;
const load = (a: string, b: string) => [a, b] as unknown as Loadout;

describe('the cooldown track takes a charged Minor unchanged', () => {
  it('gives it a slot, exactly as it does a Major', () => {
    // `slotsFor` never asked about tier — this is the assertion that it never had
    // to, and that the ticket's "no engine change" reading is right.
    expect(slotsFor(load('rust', 'whetstone'))).toEqual({
      rust: { opening: 0, recharge: 3 },
      whetstone: { opening: 0, recharge: 2 },
    });
  });

  it('charges its own recharge when it fires, not the Major ladder rate', () => {
    const after = abilityMarks(load('rust', 'whetstone'), [[{ id: 'whetstone' }]]);
    // Rust took the decrement and stayed at 0; Whetstone took its own 2, not Rust's 3.
    expect(after).toEqual({
      rust: { marks: 0, available: true },
      whetstone: { marks: 2, available: false },
    });
  });

  it('comes back on the round its own recharge names', () => {
    const fired = [[{ id: 'whetstone' }], [], []];
    expect(abilityMarks(load('rust', 'whetstone'), fired).whetstone).toEqual({
      marks: 0,
      available: true,
    });
  });

  it('withdraws the offer for a charge spent in the round being played', () => {
    expect(chargesNow(load('rust', 'whetstone'), [[]], [{ id: 'whetstone' }]).whetstone).toEqual({
      marks: 0,
      available: false,
    });
  });
});

describe('a charged Minor still costs one mark on its bound move', () => {
  const pick = uniformPicker(() => 0);

  it('prices the pairing by tier, with the charge slot costing nothing extra', () => {
    // Rust is a Major at 2, Whetstone a Minor at 1. That Whetstone also carries a
    // charge does not enter the price — AC #2's whole point.
    expect(loadoutPrice(load('rust', 'whetstone'))).toBe(MARK_COST.Major + MARK_COST.Minor);
    expect(loadoutPrice(load('rust', 'whetstone'))).toBe(3);
  });

  it('lays its single mark on its bound move like any other Minor', () => {
    const { delays, rolledMove } = openingMarks(load('rust', 'whetstone'), pick);
    // Rust binds scissors, Whetstone robot — no collision, so nothing is displaced.
    expect(delays).toEqual({ rock: 0, paper: 0, scissors: 2, lizard: 0, robot: 1 });
    expect(rolledMove).toBeNull();
  });

  it('is the one displaced when it collides with a Major, being the cheaper card', () => {
    // Ferrus also binds robot, and at 2 marks outprices Whetstone's 1.
    const { delays, rolledMove } = openingMarks(load('ferrus', 'whetstone'), pick);
    expect(delays.robot).toBe(MARK_COST.Major);
    expect(rolledMove).not.toBeNull();
    expect(delays[rolledMove!]).toBe(MARK_COST.Minor);
    expect(helpersIn(load('ferrus', 'whetstone')).map((h) => h.tier)).toEqual(['Major', 'Minor']);
  });
});

/**
 * AC #4, restated against the rule that actually shipped.
 *
 * The ticket asks that a Major + Minor pairing "still permits only one firing per
 * seat per round". That was true when it was written and is not now: JQ-238 landed
 * first and made the cap one firing per *slot* per round, precisely so a second
 * charge card is worth its standalone value. Asserting the ticket's wording would
 * pin behaviour the repo deliberately removed, so this pins the shipped rule — two
 * slots, two firings, and the same slot refused twice.
 */
describe('GameService — a Major and a charged Minor in one loadout', () => {
  let repo: InstanceType<typeof MemoryGameRepository>;
  let service: InstanceType<typeof GameService>;

  beforeEach(() => {
    repo = new MemoryGameRepository();
    service = new GameService(repo, { rng: () => 0 });
  });

  async function match(alice = ['rust', 'whetstone'], bob = ['quarantine', 'poker-face']) {
    const created = await service.createStandaloneMatch({
      gameMode: 'duel-helpers',
      hostName: 'Alice',
      bestOf: 5,
      seats: [
        { seatKey: '1', options: [{ groupKey: 'helpers', optionIds: alice }] },
        { seatKey: '2', options: [{ groupKey: 'helpers', optionIds: bob }] },
      ],
    });
    const joined = await service.claimSeat(created.state.match.code, { seatKey: '2', name: 'Bob' });
    return {
      code: created.state.match.code,
      alice: created.you.playerId,
      bob: joined.you.playerId,
    };
  }

  it('offers both charges before either is spent', async () => {
    const { code, alice } = await match();
    expect((await service.getState(code, alice)).abilities).toEqual({
      rust: { marks: 0, available: true },
      whetstone: { marks: 0, available: true },
    });
  });

  it('accepts the Minor firing, and leaves the Major charged', async () => {
    const { code, alice } = await match();
    const after = await service.fireAbility(code, alice, { helperId: 'whetstone' });
    expect(after.abilities).toEqual({
      rust: { marks: 0, available: true },
      whetstone: { marks: 0, available: false },
    });
  });

  it('fires both in one round, each spending its own recharge', async () => {
    const { code, alice, bob } = await match();
    await service.fireAbility(code, alice, { helperId: 'rust', target: 'scissors' });
    await service.fireAbility(code, alice, { helperId: 'whetstone' });

    await service.submitMove(code, alice, 'rock');
    await service.submitMove(code, bob, 'rock');

    // Rust recharges on 3 and Whetstone on 2. Two slots, two clocks.
    expect((await service.getState(code, alice)).abilities).toEqual({
      rust: { marks: 3, available: false },
      whetstone: { marks: 2, available: false },
    });
  });

  it('records the Minor firing on the round it resolves', async () => {
    const { code, alice, bob } = await match();
    await service.fireAbility(code, alice, { helperId: 'whetstone' });
    await service.submitMove(code, alice, 'rock');
    const state = await service.submitMove(code, bob, 'rock');

    expect(state.abilityFirings).toEqual([
      { round: 1, seatKey: '1', helperId: 'whetstone', target: null, source: null },
    ]);
  });

  it('refuses the same Minor slot twice in one round', async () => {
    const { code, alice } = await match();
    await service.fireAbility(code, alice, { helperId: 'whetstone' });
    await expect(service.fireAbility(code, alice, { helperId: 'whetstone' })).rejects.toThrow(
      /already fired 'whetstone'/,
    );
  });

  it("refuses a Minor charge the seat does not hold", async () => {
    const { code, bob } = await match();
    await expect(service.fireAbility(code, bob, { helperId: 'whetstone' })).rejects.toThrow(
      /does not hold 'whetstone'/,
    );
  });

  it('holds the Minor back until its own recharge is paid', async () => {
    const { code, alice, bob } = await match();
    await service.fireAbility(code, alice, { helperId: 'whetstone' });
    await service.submitMove(code, alice, 'rock');
    await service.submitMove(code, bob, 'rock');

    // Recharge 2: one decrement is not enough, and the service must say so rather
    // than take a charge that is not there.
    await expect(service.fireAbility(code, alice, { helperId: 'whetstone' })).rejects.toThrow(
      /is not charged/,
    );
  });
});
