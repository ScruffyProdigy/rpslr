import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Loadout } from '@game/helpers/loadout';
import type { MatchState, Seat } from '../api';
import { LOADOUT_REVEAL_MS, useLoadoutReveal } from './useLoadoutReveal';

const NOW = 1_700_000_000_000;
const ME = 'player-a';

function seat(seatKey: string, playerId: string, loadout: Loadout | null): Seat {
  return {
    id: `seat-${seatKey}`,
    matchId: 'm1',
    seatKey,
    teamKey: null,
    role: null,
    position: 0,
    reservedForLobbyUser: null,
    player: { id: playerId, name: playerId, lobbyUserId: null, score: 0, profile: null, expiryStrikes: 0 },
    lobbyProfile: null,
    delays: {},
    loadout,
    loadoutRoll: null,
  };
}

function state(over: {
  /** Milliseconds of round 1 the server says have already gone by. */
  elapsedMs?: number;
  loadout?: Loadout | null;
  round?: number;
  results?: MatchState['results'];
  submitted?: string[];
  startedAt?: string | null;
} = {}): MatchState {
  const {
    elapsedMs = 0,
    loadout = ['ferrus', 'echo-chamber'] as Loadout,
    round = 1,
    results = [],
    submitted = [],
    startedAt = new Date(NOW).toISOString(),
  } = over;
  return {
    match: {
      id: 'm1',
      code: 'RPS-TEST',
      externalMatchId: null,
      lobbyId: null,
      lobbyReturnUrl: null,
      lobbyGraphqlUrl: null,
      name: 'Test',
      gameMode: 'duel-helpers',
      status: 'playing',
      bestOf: 5,
      currentRound: round,
      phase: 'pick',
      phaseStartedAt: startedAt,
      phaseDeadline: new Date(NOW + 60_000).toISOString(),
      endReason: null,
      winnerSeatKey: null,
      createdAt: new Date(NOW).toISOString(),
    },
    seats: [seat('a', ME, loadout), seat('b', 'player-b', loadout)],
    results,
    submittedPlayerIds: submitted,
    currentRoundMoves: {},
    matchWinnerSeatKey: null,
    abilityFirings: [],
    abilities: {},
    entitlement: null,
    serverNow: new Date(NOW + elapsedMs).toISOString(),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('useLoadoutReveal (JQ-149)', () => {
  it('opens on a match that has just started with loadouts on the table', () => {
    const { result } = renderHook(() => useLoadoutReveal(state(), ME));
    expect(result.current.open).toBe(true);
  });

  it('renders nothing for duel, which brings no loadout', () => {
    const { result } = renderHook(() => useLoadoutReveal(state({ loadout: null }), ME));
    expect(result.current.open).toBe(false);
  });

  it('closes when the player skips it', () => {
    const { result } = renderHook(() => useLoadoutReveal(state(), ME));
    act(() => result.current.dismiss());
    expect(result.current.open).toBe(false);
  });

  it('closes on its own once the window is up', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useLoadoutReveal(state(), ME));
    expect(result.current.open).toBe(true);
    act(() => {
      vi.advanceTimersByTime(LOADOUT_REVEAL_MS + 10);
    });
    expect(result.current.open).toBe(false);
  });

  it('does not replay for a reload that lands after the window', () => {
    // The point of measuring from `phaseStartedAt` against the server's own
    // clock: this hook has never run before, and still knows it has missed it.
    const { result } = renderHook(() =>
      useLoadoutReveal(state({ elapsedMs: LOADOUT_REVEAL_MS + 1_000 }), ME),
    );
    expect(result.current.open).toBe(false);
  });

  it('still opens for a reload that lands inside the window', () => {
    const { result } = renderHook(() =>
      useLoadoutReveal(state({ elapsedMs: LOADOUT_REVEAL_MS - 2_000 }), ME),
    );
    expect(result.current.open).toBe(true);
  });

  it('closes as soon as the remaining window elapses, not a full window later', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useLoadoutReveal(state({ elapsedMs: LOADOUT_REVEAL_MS - 2_000 }), ME),
    );
    act(() => {
      vi.advanceTimersByTime(2_100);
    });
    expect(result.current.open).toBe(false);
  });

  it('stays shut once the first round has been played', () => {
    const results = [{ round: 1, outcome: 'a', moves: {}, autoPicked: [] }];
    const { result } = renderHook(() => useLoadoutReveal(state({ round: 2, results }), ME));
    expect(result.current.open).toBe(false);
  });

  it('stays shut for a seat that has already locked in', () => {
    const { result } = renderHook(() => useLoadoutReveal(state({ submitted: [ME] }), ME));
    expect(result.current.open).toBe(false);
  });

  it('still opens while the opponent alone has locked in', () => {
    const { result } = renderHook(() => useLoadoutReveal(state({ submitted: ['player-b'] }), ME));
    expect(result.current.open).toBe(true);
  });

  it('stays shut before the match is on the clock', () => {
    // No phase means no seat has arrived yet, so there is no window to be inside.
    const { result } = renderHook(() => useLoadoutReveal(state({ startedAt: null }), ME));
    expect(result.current.open).toBe(false);
  });

  it('survives a snapshot arriving mid-window without re-opening a dismissed reveal', () => {
    const { result, rerender } = renderHook(
      ({ elapsedMs }) => useLoadoutReveal(state({ elapsedMs }), ME),
      { initialProps: { elapsedMs: 0 } },
    );
    act(() => result.current.dismiss());
    rerender({ elapsedMs: 1_000 });
    expect(result.current.open).toBe(false);
  });
});
