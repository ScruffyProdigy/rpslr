/**
 * A loadout is the two helpers a player brings, and the opening marks they cost.
 *
 * Kept apart from `rules.ts` because this half is arithmetic over the roster —
 * what a pairing costs and where the marks land — while that half is what each
 * card actually does to a round.
 */

import { MOVES, type DelayMap, type Move } from '../game.js';
import { MARK_COST, getHelper, type HelperDef, type HelperId } from './roster.js';

/** Any two distinct helpers. No slot rule — the tier ladder does the balancing. */
export type Loadout = readonly [HelperId, HelperId];

/**
 * Follows the repo's parse convention (see `parseLobbyProvision` in
 * `provision.ts`): a value on success, a human-readable reason on failure, so the
 * caller decides the status code. JQ-148's provision endpoint turns the string
 * into a 400.
 */
export function parseLoadout(raw: unknown): Loadout | string {
  if (!Array.isArray(raw) || raw.length !== 2) return 'a loadout needs exactly 2 helpers';
  const ids: HelperId[] = [];
  for (const value of raw) {
    if (typeof value !== 'string' || !value.trim()) return 'a loadout needs exactly 2 helpers';
    const id = value.trim();
    const helper = getHelper(id);
    if (!helper) return `unknown helper: ${id}`;
    ids.push(helper.id as HelperId);
  }
  if (ids[0] === ids[1]) return 'a loadout needs two different helpers';
  return [ids[0], ids[1]] as const;
}

/** The two cards a loadout names, in the order the player picked them. */
export function helpersIn(loadout: Loadout): [HelperDef, HelperDef] {
  return [getHelper(loadout[0])!, getHelper(loadout[1])!];
}

/** What a loadout costs in opening marks, whatever it spends them on. */
export function loadoutPrice(loadout: Loadout): number {
  return helpersIn(loadout).reduce((n, h) => n + MARK_COST[h.tier], 0);
}

/** Chooses where a displaced mark lands. Injected so this module stays pure. */
export type MovePicker = (candidates: Move[]) => Move;

/** Builds a uniform picker over a `Math.random`-shaped source. */
export function uniformPicker(rng: () => number): MovePicker {
  return (candidates) => {
    const index = Math.floor(rng() * candidates.length);
    // An rng that returns exactly 1 would index off the end; clamp rather than trust it.
    return candidates[Math.min(candidates.length - 1, index)];
  };
}

export interface Opening {
  delays: DelayMap;
  /** Where the cheaper helper's marks were displaced to, or null if no collision. */
  rolledMove: Move | null;
}

const NO_MARKS: DelayMap = { rock: 0, paper: 0, scissors: 0, lizard: 0, robot: 0 };

/**
 * The marks a loadout opens with.
 *
 * Two bound helpers on the same move would stack their marks there and hand over
 * a four-live opening for free, which breaks the ramp in the direction that pays.
 * So the cheaper helper is displaced: its marks land on a move drawn uniformly
 * from those still clear, and a tie goes to the second helper picked. The count of
 * blocked moves therefore always equals the count of bound helpers, which is what
 * the tier ladder is priced against.
 */
export function openingMarks(loadout: Loadout, pick: MovePicker): Opening {
  const delays: DelayMap = { ...NO_MARKS };
  const bound = helpersIn(loadout).filter((h) => h.boundMove !== null);
  const collides = bound.length === 2 && bound[0].boundMove === bound[1].boundMove;

  if (!collides) {
    for (const h of bound) delays[h.boundMove as Move] += MARK_COST[h.tier];
    return { delays, rolledMove: null };
  }

  // `>=` keeps the first-picked helper on a tie, so the second one is displaced.
  const [one, two] = bound;
  const [keeper, displaced] =
    MARK_COST[one.tier] >= MARK_COST[two.tier] ? [one, two] : [two, one];

  delays[keeper.boundMove as Move] += MARK_COST[keeper.tier];
  const rolledMove = pick(MOVES.filter((m) => delays[m] === 0));
  delays[rolledMove] += MARK_COST[displaced.tier];
  return { delays, rolledMove };
}
