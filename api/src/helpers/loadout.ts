/**
 * A loadout is the two helpers a player brings, and the opening marks they cost.
 *
 * Kept apart from `rules.ts` because this half is arithmetic over the roster —
 * what a pairing costs and where the marks land — while that half is what each
 * card actually does to a round.
 */

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
