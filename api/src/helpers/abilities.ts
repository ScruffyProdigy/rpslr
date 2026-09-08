/**
 * The ability cooldown track.
 *
 * An ability occupies its own slot on the same track a move does, counted in the
 * same delay marks: `opening` is what it starts on, `recharge` is what firing
 * costs, and a mark comes off every round. So this is `computeDelays` for
 * charges, and it is pure for the same reason — a seat's charges are a fold over
 * the rounds it has played, never state held in a process. A charge tracked in
 * memory would be lost on restart and invisible to a second replica.
 *
 * The one thing that is *not* derivable: firing is a choice. What each seat fired
 * has to arrive with the round, which is why `PlayedRound` carries it.
 */

import type { AbilitySlots } from '../game.js';
import { helpersIn, type Loadout } from './loadout.js';
import { isAbility } from './roster.js';

/** Where one ability's cooldown stands. */
export interface AbilityState {
  /**
   * Marks before it may fire — 0 is now.
   *
   * `null` is never: a `recharge: null` ability that has fired is spent for the
   * match. Deliberately not `Infinity`, which `JSON.stringify` turns into `null`
   * anyway and which a client comparing `marks > 0` would read as available.
   */
  marks: number | null;
  available: boolean;
}

export type AbilityMap = Record<string, AbilityState>;

/** All this fold needs of a firing. `PlayedRound`'s `Firing` satisfies it. */
export interface Fired {
  id: string;
}

/** The ability slots a loadout brings. Passives hold none, so most loadouts are empty. */
export function slotsFor(loadout: Loadout | null): AbilitySlots {
  if (!loadout) return {};
  const slots: AbilitySlots = {};
  for (const helper of helpersIn(loadout)) {
    if (isAbility(helper.load)) {
      slots[helper.id] = { opening: helper.load.opening, recharge: helper.load.recharge };
    }
  }
  return slots;
}

/**
 * Where a set of ability slots stands after the given rounds.
 *
 * Takes slots rather than a loadout so the `recharge: null` case is reachable in a
 * test: the type has always allowed it, no card on the roster uses it yet, and the
 * arithmetic should not wait for one to start being right.
 */
export function slotMarks(slots: AbilitySlots, firings: readonly (readonly Fired[])[]): AbilityMap {
  const marks = new Map<string, number | null>();
  for (const [id, slot] of Object.entries(slots)) marks.set(id, slot.opening);

  for (const round of firings) {
    // A mark a round, floored at zero, exactly as a move's comes off.
    for (const [id, m] of marks) if (m !== null) marks.set(id, Math.max(0, m - 1));
    for (const { id } of round) {
      const slot = slots[id];
      // A firing naming an ability this seat does not hold is not this fold's to
      // reject — the caller validates. Ignoring it keeps the fold total.
      if (!slot) continue;
      const current = marks.get(id);
      marks.set(id, slot.recharge === null ? null : (current ?? 0) + slot.recharge);
    }
  }

  return Object.fromEntries(
    [...marks].map(([id, m]) => [id, { marks: m, available: m === 0 }]),
  );
}

/** Where a loadout's abilities stand after the given rounds. Mirrors `computeDelays`. */
export function abilityMarks(
  loadout: Loadout | null,
  firings: readonly (readonly Fired[])[],
): AbilityMap {
  return slotMarks(slotsFor(loadout), firings);
}

/**
 * A seat's charges as they stand *now* — the fold over resolved rounds, with an
 * unresolved firing in the round being played marked spent.
 *
 * The fold cannot simply be handed the pending round. `slotMarks` takes a mark off
 * per round and then charges that round's recharge, and the round being played has
 * earned neither: its decrement lands when it resolves. But a charge already spent
 * in it must not read `available`, or a client would offer a card the repository's
 * one-firing-per-round constraint is about to refuse. Suppressing availability says
 * exactly that much and leaves the arithmetic alone.
 */
export function chargesNow(
  loadout: Loadout | null,
  resolved: readonly (readonly Fired[])[],
  pending: readonly Fired[] = [],
): AbilityMap {
  const map = abilityMarks(loadout, resolved);
  for (const { id } of pending) {
    // A pending firing naming an ability this seat does not hold is the caller's to
    // reject, exactly as in `slotMarks`. Ignoring it keeps this total too.
    if (map[id]) map[id] = { ...map[id], available: false };
  }
  return map;
}
