import { describe, expect, it } from 'vitest';
import type { Loadout } from '@game/helpers/loadout';
import { MARK_COST, getHelper } from '@game/helpers/roster';
import { ALL_MOVES } from './moves';
import type { Move, Seat } from './api';
import { loadoutCards, seatLoadoutView } from './loadouts';

function seat(loadout: Loadout | null, loadoutRoll: Move | null = null): Seat {
  return {
    id: 'seat-a',
    matchId: 'm1',
    seatKey: 'a',
    teamKey: null,
    role: null,
    position: 0,
    reservedForLobbyUser: null,
    player: null,
    lobbyProfile: null,
    delays: {},
    loadout,
    loadoutRoll,
  };
}

describe('loadoutCards', () => {
  it('reads name, tier and price straight off the roster', () => {
    // Read rather than restated, which is what the test is named for: a literal
    // here would be a second copy of the card, and only a reprice could falsify
    // it. `markCost` is the one value not on the card — the tier's price, from
    // `MARK_COST` — and it is the only thing this actually has to derive.
    const expected = (['ferrus', 'echo-chamber'] as const).map((id) => {
      const helper = getHelper(id)!;
      return expect.objectContaining({
        name: helper.name,
        tier: helper.tier,
        markCost: MARK_COST[helper.tier],
        boundMove: helper.boundMove,
      });
    });
    expect(loadoutCards(['ferrus', 'echo-chamber'])).toEqual(expected);
  });

  it('gives a Trinket no bound move and no price, which is the tier', () => {
    const [, trinket] = loadoutCards(['ferrus', 'poker-face']);
    // The claim is about the tier, not about Poker Face: whatever card sits in
    // that slot, a Trinket costs `MARK_COST.Trinket` and binds nothing.
    expect(getHelper('poker-face')!.tier).toBe('Trinket');
    expect(trinket).toMatchObject({
      tier: 'Trinket',
      markCost: MARK_COST.Trinket,
      boundMove: null,
    });
  });

  it('has nothing to say about the null loadout', () => {
    expect(loadoutCards(null)).toEqual([]);
  });
});

describe('seatLoadoutView', () => {
  it('is null in duel, so no surface has to test a length to stay off that board', () => {
    expect(seatLoadoutView(seat(null))).toBeNull();
    expect(seatLoadoutView(null)).toBeNull();
  });

  it('prices the pair and names the moves it puts down', () => {
    // Each card's own move at its own tier's price, in board order — read off
    // the roster rather than restated, so a rebinding or a retier moves this
    // with it instead of failing it (JQ-256).
    const cards = ['ferrus', 'echo-chamber'].map((id) => getHelper(id)!);
    const expected = cards
      .map((h) => ({ move: h.boundMove!, marks: MARK_COST[h.tier] }))
      .sort((x, y) => ALL_MOVES.indexOf(x.move) - ALL_MOVES.indexOf(y.move));
    // The pair is chosen so nothing collides; a collision is the test below.
    expect(new Set(cards.map((h) => h.boundMove)).size).toBe(2);

    const view = seatLoadoutView(seat(['ferrus', 'echo-chamber']))!;
    expect(view.price).toBe(expected.reduce((n, o) => n + o.marks, 0));
    expect(view.opening).toEqual(expected);
    expect(view.displaced).toBeNull();
  });

  it('leaves all five live for a loadout that binds nothing', () => {
    // Two Trinkets, which is the tier that binds no move and costs nothing.
    for (const id of ['poker-face', 'copycat']) {
      expect(getHelper(id)!.boundMove, id).toBeNull();
    }
    const view = seatLoadoutView(seat(['poker-face', 'copycat']))!;
    expect(view.price).toBe(0);
    expect(view.opening).toEqual([]);
  });

  it('names where a same-move pairing put the displaced marks, and how deep', () => {
    // Ferrus beside Well Oiled: both bind the same move, so the cheaper helper's
    // mark was displaced when the match was created, and this is the first
    // surface that can say where it went. Which card is the cheaper one, and
    // what each lays down, is read off the roster (JQ-256).
    const [dear, cheap] = ['ferrus', 'well-oiled']
      .map((id) => getHelper(id)!)
      .sort((x, y) => MARK_COST[y.tier] - MARK_COST[x.tier]);
    expect(dear.boundMove).toBe(cheap.boundMove);

    const view = seatLoadoutView(seat(['ferrus', 'well-oiled'], 'lizard'))!;
    expect(view.displaced).toEqual({ move: 'lizard', marks: MARK_COST[cheap.tier] });
    expect(view.opening).toEqual(
      [
        { move: 'lizard' as const, marks: MARK_COST[cheap.tier] },
        { move: dear.boundMove!, marks: MARK_COST[dear.tier] },
      ].sort((x, y) => ALL_MOVES.indexOf(x.move) - ALL_MOVES.indexOf(y.move)),
    );
    // The count of blocked moves still equals the count of bound helpers — the
    // invariant the tier ladder is priced against (JQ-147).
    expect(view.opening).toHaveLength(2);
  });
});
