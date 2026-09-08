/**
 * What one client is allowed to see of a match.
 *
 * The hub used to broadcast a `MatchState` straight through, which was safe only
 * while every field in it was public. Charge state is not: a seat that has fired
 * this round has a charge that reads unavailable, and that difference *is* the
 * secret — an opponent who saw it would know a firing is coming without knowing
 * which, which is enough to change what they play. Quarantine's whole value is
 * that its guess is unreadable.
 *
 * So the service publishes a `MatchSnapshot`, which holds the public state plus
 * each seat's private view, and the only way to get a `MatchState` back out is
 * `viewSnapshotAs`. A subscriber that forgets to project gets a snapshot rather
 * than a leak — the type is the guard, not a code review.
 */

import type { AbilityMap } from './helpers/abilities.js';
import type { MatchState } from './types.js';

export interface MatchSnapshot {
  /** Everything both seats may see. Its `abilities` is empty by construction. */
  readonly shared: MatchState;
  /** Per player id, that seat's own charge state — including this round's firing. */
  readonly abilitiesByPlayerId: Readonly<Record<string, AbilityMap>>;
}

/**
 * The snapshot as one viewer sees it.
 *
 * An unidentified viewer (a spectator socket, the REST state route) gets the
 * shared view: no charges rather than someone else's.
 */
export function viewSnapshotAs(snapshot: MatchSnapshot, playerId: string | null): MatchState {
  const abilities = playerId ? snapshot.abilitiesByPlayerId[playerId] : undefined;
  if (!abilities) return snapshot.shared;
  return { ...snapshot.shared, abilities };
}
