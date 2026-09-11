import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Loadout } from '@game/helpers/loadout';
import type { MatchState, Phase, Seat } from '../api';
import { useLoadoutReveal } from './useLoadoutReveal';

/**
 * Most of what this hook used to do is the server's now (JQ-149): the reveal is a
 * phase with its own deadline, so there is no window to measure here and no timer
 * to restart on a reload. What is left is "render what the match says it is
 * doing", plus the one piece that has to stay local — a player who is done
 * reading gets their board back without waiting on the other seat.
 */
const NOW = 1_700_000_000_000;

function seat(seatKey: string, playerId: string, loadout: Loadout | null): Seat {
  return {
    id: `seat-${seatKey}`,
    matchId: 'm1',
    seatKey,
    teamKey: null,
    role: null,
    position: 0,
    reservedForLobbyUser: null,
    player: {
      id: playerId,
      name: playerId,
      lobbyUserId: null,
      score: 0,
      profile: null,
      expiryStrikes: 0,
    },
    lobbyProfile: null,
    delays: {},
    loadout,
    loadoutRoll: null,
  };
}

function state(over: { phase?: Phase | null; loadout?: Loadout | null; matchId?: string } = {}): MatchState {
  const {
    phase = 'loadouts',
    loadout = ['ferrus', 'echo-chamber'] as Loadout,
    matchId = 'm1',
  } = over;
  return {
    match: {
      id: matchId,
      code: 'RPS-TEST',
      externalMatchId: null,
      lobbyId: null,
      lobbyReturnUrl: null,
      lobbyGraphqlUrl: null,
      name: 'Test',
      gameMode: 'duel-helpers',
      status: 'playing',
      bestOf: 5,
      currentRound: 1,
      phase,
      phaseStartedAt: new Date(NOW).toISOString(),
      phaseDeadline: new Date(NOW + 45_000).toISOString(),
      endReason: null,
      winnerSeatKey: null,
      createdAt: new Date(NOW).toISOString(),
    },
    seats: [seat('a', 'player-a', loadout), seat('b', 'player-b', loadout)],
    results: [],
    submittedPlayerIds: [],
    currentRoundMoves: {},
    matchWinnerSeatKey: null,
    abilityFirings: [],
    abilities: {},
    entitlement: null,
    serverNow: new Date(NOW).toISOString(),
  };
}

describe('useLoadoutReveal (JQ-149)', () => {
  it('opens while the match says it is revealing loadouts', () => {
    const { result } = renderHook(() => useLoadoutReveal(state()));
    expect(result.current.open).toBe(true);
  });

  it('stays shut on every other phase', () => {
    for (const phase of ['pick', 'react', null] as const) {
      const { result } = renderHook(() => useLoadoutReveal(state({ phase })));
      expect(result.current.open).toBe(false);
    }
  });

  it('stays shut with no match at all', () => {
    const { result } = renderHook(() => useLoadoutReveal(null));
    expect(result.current.open).toBe(false);
  });

  it('renders nothing for duel, which brings no loadout to reveal', () => {
    const { result } = renderHook(() => useLoadoutReveal(state({ loadout: null })));
    expect(result.current.open).toBe(false);
  });

  it('closes for the player who has read it, while the phase runs on', () => {
    // The phase does not end until both seats have read it, and this player
    // should not be held in front of a sheet they are done with. The board they
    // get back is inert — that is the board's business, not this hook's.
    const { result, rerender } = renderHook(() => useLoadoutReveal(state()));
    act(() => result.current.dismiss());
    expect(result.current.open).toBe(false);
    rerender();
    expect(result.current.open).toBe(false);
  });

  it('does not re-open when a snapshot arrives mid-phase', () => {
    const { result, rerender } = renderHook(({ s }) => useLoadoutReveal(s), {
      initialProps: { s: state() },
    });
    act(() => result.current.dismiss());
    rerender({ s: state() });
    expect(result.current.open).toBe(false);
  });

  it('restores to the phase rather than replaying, because the phase is server state', () => {
    // A reconnecting player mounts this hook for the first time mid-phase and
    // gets the reveal; one who reconnects after it has ended does not. There is
    // no local clock either answer could disagree with.
    expect(renderHook(() => useLoadoutReveal(state())).result.current.open).toBe(true);
    expect(renderHook(() => useLoadoutReveal(state({ phase: 'pick' }))).result.current.open).toBe(
      false,
    );
  });

  it('forgets a dismissal once the phase is over', () => {
    const { result, rerender } = renderHook(({ s }) => useLoadoutReveal(s), {
      initialProps: { s: state() },
    });
    act(() => result.current.dismiss());
    rerender({ s: state({ phase: 'pick' }) });
    rerender({ s: state({ phase: 'loadouts', matchId: 'm2' }) });
    expect(result.current.open).toBe(true);
  });
});
