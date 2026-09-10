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
 *
 * Three things are seat-private now: charge state, the seat's own move in the
 * round being played, and the seat's claim on the mid-round sub-phase. They travel
 * together because they leak together — Oracle names a move the opponent did *not*
 * play precisely so that the projection has something safe to carry.
 */

import type { Move } from './game.js';
import type { AbilityMap } from './helpers/abilities.js';
import type { Entitlement, MatchState } from './types.js';

export interface MatchSnapshot {
  /**
   * Everything both seats may see. Its `abilities`, `entitlement` and
   * `currentRoundMoves` are empty by construction.
   */
  readonly shared: MatchState;
  /** Per player id, that seat's own charge state — including this round's firing. */
  readonly abilitiesByPlayerId: Readonly<Record<string, AbilityMap>>;
  /**
   * Per player id, that seat's own move in the round being played.
   *
   * Seat-private, and the shared view holds none: an opponent who could read
   * this would not need to guess. It is projected rather than merely withheld
   * because the sub-phase asks an entitled seat to keep or change a move, and a
   * player who reconnected into it with no idea what they had chosen would be
   * deciding blind.
   */
  readonly movesByPlayerId: Readonly<Record<string, Move>>;
  /**
   * Per player id, that seat's claim on the sub-phase — present only for a seat
   * entitled to one, and only while it is running.
   */
  readonly entitlementByPlayerId: Readonly<Record<string, Entitlement>>;
}

/**
 * The snapshot as one viewer sees it.
 *
 * An unidentified viewer (a spectator socket, the REST state route) gets the
 * shared view: no charges rather than someone else's.
 */
export function viewSnapshotAs(snapshot: MatchSnapshot, playerId: string | null): MatchState {
  if (!playerId) return snapshot.shared;
  const abilities = snapshot.abilitiesByPlayerId[playerId];
  // Not a seat in this match — a spectator naming someone, or a stale id. The
  // shared view, rather than a guess at whose seat they meant.
  if (!abilities) return snapshot.shared;
  const own = snapshot.movesByPlayerId[playerId];
  return {
    ...snapshot.shared,
    abilities,
    currentRoundMoves: own ? { [playerId]: own } : {},
    entitlement: snapshot.entitlementByPlayerId[playerId] ?? null,
  };
}
