/**
 * A loadout, as the board has to say it out loud.
 *
 * Pure, and deliberately thin: everything here is either a lookup in the roster
 * or a re-reading of what the server already sent. The one number that could
 * have been re-derived — where a same-move collision put the displaced marks —
 * is read out of `rulesForSeats` instead, which is the server's own module and
 * the same one the board already asks for `myOpeningDelays` (JQ-207). A second
 * copy of that arithmetic in the frontend is exactly the drift that argument
 * exists to prevent.
 */

import { rulesForSeats, type SeatLoadout } from '@game/replayBoard';
import type { Loadout } from '@game/helpers/loadout';
import { MARK_COST, getHelper, type Tier } from '@game/helpers/roster';
import type { DelayMap } from '@game/game';
import type { Move, Seat } from './api';
import { ALL_MOVES } from './moves';

/** A seat that brought no helpers — the `duel` opening, and the side we ignore. */
const NO_LOADOUT: SeatLoadout = { loadout: null, loadoutRoll: null };

/** One helper, with everything the reveal says about it. */
export interface LoadoutCard {
  id: string;
  name: string;
  tier: Tier;
  /** What the tier costs in opening marks. A Trinket's 0 is a fact, not a gap. */
  markCost: number;
  /** The move those marks land on, or null for a Trinket, which binds none. */
  boundMove: Move | null;
  blurb: string;
}

/** One move that starts down, and how deep. */
export interface OpeningMark {
  move: Move;
  marks: number;
}

/** Everything the reveal shows for one seat. */
export interface SeatLoadoutView {
  cards: LoadoutCard[];
  /** Total opening marks — the price of the pair, in the currency the board uses. */
  price: number;
  /** Which moves start down and how deep, in board order. */
  opening: OpeningMark[];
  /**
   * Where a same-move pairing put the cheaper helper's marks, or null when there
   * was no collision. The match has been carrying this since it was created; the
   * reveal is the first moment either player can see it.
   */
  displaced: OpeningMark | null;
}

/** The roster's own words for the two helpers a loadout names. */
export function loadoutCards(loadout: Loadout | null): LoadoutCard[] {
  if (!loadout) return [];
  return loadout.map((id) => {
    const helper = getHelper(id);
    return {
      id,
      name: helper?.name ?? id,
      // An id the roster does not know cannot be priced, so it is priced at
      // nothing rather than at a guess. Unreachable through provision, which
      // rejects an unknown helper with a 400 — this is what a client one
      // version behind a roster addition renders instead of crashing.
      tier: helper?.tier ?? 'Trinket',
      markCost: helper ? MARK_COST[helper.tier] : 0,
      boundMove: (helper?.boundMove as Move | null) ?? null,
      blurb: helper?.blurb ?? '',
    };
  });
}

/** The moves carrying opening marks, in the order the pentagon lists them. */
function marksIn(delays: DelayMap): OpeningMark[] {
  return ALL_MOVES.filter((move) => (delays[move] ?? 0) > 0).map((move) => ({
    move,
    marks: delays[move],
  }));
}

/**
 * What one seat brought, or null when it brought nothing.
 *
 * Null rather than an empty view, because `duel` must render none of this and a
 * caller that has to test `view.cards.length` to find that out is one refactor
 * away from rendering an empty panel over a duel board.
 */
export function seatLoadoutView(seat: Seat | null): SeatLoadoutView | null {
  if (!seat?.loadout) return null;
  const cards = loadoutCards(seat.loadout);
  // Asked of the engine rather than summed here: a collision moves marks off the
  // bound move entirely, so `boundMove` alone would describe a board this match
  // never opened on.
  const { initialDelays } = rulesForSeats(seat, NO_LOADOUT)[0];
  const roll = seat.loadoutRoll;
  return {
    cards,
    price: cards.reduce((n, c) => n + c.markCost, 0),
    opening: marksIn(initialDelays),
    displaced: roll ? { move: roll, marks: initialDelays[roll] ?? 0 } : null,
  };
}
