import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchState } from '../api';
import { useRoundDeadline } from './useRoundDeadline';

/**
 * The device clock is deliberately set far from the server's in these tests:
 * the whole point of shipping `serverNow` is that the countdown survives skew.
 */
const DEVICE_NOW = 1_700_000_000_000;

function state(over: {
  serverNow?: number;
  startedAt?: number | null;
  deadline?: number | null;
}): MatchState {
  const { serverNow = DEVICE_NOW, startedAt = DEVICE_NOW, deadline = DEVICE_NOW + 20_000 } = over;
  return {
    match: {
      id: 'm1',
      code: 'RPS-TEST',
      externalMatchId: null,
      lobbyId: null,
      lobbyReturnUrl: null,
      lobbyGraphqlUrl: null,
      name: 'Test',
      gameMode: 'duel',
      status: 'playing',
      bestOf: 5,
      currentRound: 2,
      phase: deadline === null ? null : 'pick',
      phaseStartedAt: startedAt === null ? null : new Date(startedAt).toISOString(),
      phaseDeadline: deadline === null ? null : new Date(deadline).toISOString(),
      endReason: null,
      winnerSeatKey: null,
      createdAt: new Date(DEVICE_NOW).toISOString(),
    },
    seats: [],
    results: [],
    submittedPlayerIds: [],
    currentRoundMoves: {},
    matchWinnerSeatKey: null,
    abilityFirings: [],
    // No seat in these fixtures holds a charge, which is the duel case.
    abilities: {},
    entitlement: null,
    serverNow: new Date(serverNow).toISOString(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(DEVICE_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useRoundDeadline', () => {
  it('reports nothing when no phase is on the clock', () => {
    const { result } = renderHook(() => useRoundDeadline(state({ deadline: null })));
    expect(result.current.secondsLeft).toBeNull();
    expect(result.current.expired).toBe(false);
  });

  it('reports nothing without a match at all', () => {
    const { result } = renderHook(() => useRoundDeadline(null));
    expect(result.current.secondsLeft).toBeNull();
  });

  it('counts down from the deadline', () => {
    const { result } = renderHook(() => useRoundDeadline(state({})));
    expect(result.current.secondsLeft).toBe(20);
  });

  it('takes the allowance from the server rather than from arrival time', () => {
    // A snapshot received halfway through the round still knows the round was
    // 20s long; inferring it from arrival would say 10 and never move a ring.
    const { result } = renderHook(() =>
      useRoundDeadline(
        state({
          serverNow: DEVICE_NOW,
          startedAt: DEVICE_NOW - 10_000,
          deadline: DEVICE_NOW + 10_000,
        }),
      ),
    );
    expect(result.current.totalSeconds).toBe(20);
    expect(result.current.secondsLeft).toBe(10);
  });

  it('counts down correctly when the device clock is minutes fast', () => {
    // Device is 5 minutes ahead of the server. Naive arithmetic against the
    // absolute deadline would report the round as long expired.
    const { result } = renderHook(() =>
      useRoundDeadline(
        state({
          serverNow: DEVICE_NOW - 300_000,
          startedAt: DEVICE_NOW - 300_000,
          deadline: DEVICE_NOW - 300_000 + 20_000,
        }),
      ),
    );
    expect(result.current.secondsLeft).toBe(20);
    expect(result.current.expired).toBe(false);
  });

  it('counts down correctly when the device clock is minutes slow', () => {
    const { result } = renderHook(() =>
      useRoundDeadline(
        state({
          serverNow: DEVICE_NOW + 300_000,
          startedAt: DEVICE_NOW + 300_000,
          deadline: DEVICE_NOW + 300_000 + 20_000,
        }),
      ),
    );
    expect(result.current.secondsLeft).toBe(20);
  });

  it('floors at zero and reports expiry rather than going negative', () => {
    const { result } = renderHook(() =>
      useRoundDeadline(
        state({ startedAt: DEVICE_NOW - 25_000, deadline: DEVICE_NOW - 5_000 }),
      ),
    );
    expect(result.current.secondsLeft).toBe(0);
    expect(result.current.expired).toBe(true);
  });

  it('survives a malformed deadline instead of rendering NaN', () => {
    const broken = state({});
    broken.match.phaseDeadline = 'not-a-date';
    const { result } = renderHook(() => useRoundDeadline(broken));
    expect(result.current.secondsLeft).toBeNull();
  });
});
