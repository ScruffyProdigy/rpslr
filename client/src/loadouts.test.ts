import { describe, expect, it } from 'vitest';
import type { Loadout } from '@game/helpers/loadout';
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
    expect(loadoutCards(['ferrus', 'echo-chamber'])).toEqual([
      expect.objectContaining({ name: 'Ferrus', tier: 'Major', markCost: 2, boundMove: 'robot' }),
      expect.objectContaining({
        name: 'Echo Chamber',
        tier: 'Minor',
        markCost: 1,
        boundMove: 'paper',
      }),
    ]);
  });

  it('gives a Trinket no bound move and no price, which is the tier', () => {
    const [, trinket] = loadoutCards(['ferrus', 'poker-face']);
    expect(trinket).toMatchObject({ tier: 'Trinket', markCost: 0, boundMove: null });
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
    const view = seatLoadoutView(seat(['ferrus', 'echo-chamber']))!;
    expect(view.price).toBe(3);
    expect(view.opening).toEqual([
      { move: 'paper', marks: 1 },
      { move: 'robot', marks: 2 },
    ]);
    expect(view.displaced).toBeNull();
  });

  it('leaves all five live for a loadout that binds nothing', () => {
    const view = seatLoadoutView(seat(['poker-face', 'copycat']))!;
    expect(view.price).toBe(0);
    expect(view.opening).toEqual([]);
  });

  it('names where a same-move pairing put the displaced marks, and how deep', () => {
    // Ferrus (Major, robot, 2) beside Well Oiled (Minor, robot, 1): the cheaper
    // helper's mark was moved when the match was created, and this is the first
    // surface that can say where it went.
    const view = seatLoadoutView(seat(['ferrus', 'well-oiled'], 'lizard'))!;
    expect(view.displaced).toEqual({ move: 'lizard', marks: 1 });
    expect(view.opening).toEqual([
      { move: 'lizard', marks: 1 },
      { move: 'robot', marks: 2 },
    ]);
    // The count of blocked moves still equals the count of bound helpers — the
    // invariant the tier ladder is priced against (JQ-147).
    expect(view.opening).toHaveLength(2);
  });
});
