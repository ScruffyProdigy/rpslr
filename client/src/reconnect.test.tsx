/**
 * What the client does about a player who is away, and how it gets one back.
 *
 * The board half: a held seat is drawn as held, and the player still there is
 * told the match is waiting rather than left staring at one that has quietly
 * stopped. The request half: recovery path 1 asks the game — not Lobby — to
 * hand this browser back the seat it already holds.
 *
 * @see docs/lobby-protocol-handoff.md#reconnecting-a-player
 */

import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Board } from './App';
import { api, type MatchState, type Seat } from './api';

const MY_SEAT = 'a';
const MY_PLAYER = 'player-a';
const OPP_PLAYER = 'player-b';

function seat(seatKey: string, playerId: string, name: string, connected?: boolean): Seat {
  return {
    id: `seat-${seatKey}`,
    matchId: 'match-1',
    seatKey,
    teamKey: null,
    role: seatKey === MY_SEAT ? 'Challenger' : 'Opponent',
    position: seatKey === MY_SEAT ? 0 : 1,
    reservedForLobbyUser: null,
    player: {
      id: playerId,
      name,
      lobbyUserId: null,
      score: 0,
      profile: null,
      expiryStrikes: 0,
      ...(connected === undefined ? {} : { connected }),
    },
    lobbyProfile: null,
    delays: {},
    loadout: null,
    loadoutRoll: null,
  };
}

function state(opts: { oppConnected?: boolean; submitted?: string[] } = {}): MatchState {
  const now = Date.now();
  return {
    match: {
      id: 'match-1',
      code: 'RPS-TEST',
      externalMatchId: 'ext-1',
      lobbyId: null,
      lobbyReturnUrl: null,
      lobbyGraphqlUrl: null,
      name: 'Friendly Match',
      gameMode: 'duel',
      status: 'playing',
      phase: 'pick',
      phaseStartedAt: new Date(now - 5_000).toISOString(),
      phaseDeadline: new Date(now + 15_000).toISOString(),
      endReason: null,
      winnerSeatKey: null,
      bestOf: 5,
      currentRound: 2,
      createdAt: '2026-01-01T00:00:00Z',
    },
    seats: [seat(MY_SEAT, MY_PLAYER, 'Ada'), seat('b', OPP_PLAYER, 'Grace', opts.oppConnected)],
    results: [],
    submittedPlayerIds: opts.submitted ?? [],
    currentRoundMoves: {},
    serverNow: new Date(now).toISOString(),
    abilityFirings: [],
    abilities: {},
    entitlement: null,
    matchWinnerSeatKey: null,
  };
}

function renderBoard(s: MatchState) {
  return render(
    <Board
      myPlayerId={MY_PLAYER}
      mySeatKey={MY_SEAT}
      state={s}
      connected
      error={null}
      myChosenMove={null}
      onPlay={() => {}}
    />,
  );
}

describe('a seat whose player is away', () => {
  it('says the match is waiting on them, and marks the seat', () => {
    renderBoard(state({ oppConnected: false }));

    expect(screen.getByText('Waiting for Grace to reconnect…')).toBeInTheDocument();
    expect(screen.getByText('reconnecting…')).toBeInTheDocument();
  });

  it('says nothing while they are here', () => {
    renderBoard(state({ oppConnected: true }));

    expect(screen.queryByText(/reconnect/i)).not.toBeInTheDocument();
  });

  it('says nothing when the server never told us — absence is not evidence', () => {
    // An older server, or a player on the REST path holding no socket. Drawing
    // them as gone on that would be a lie about a live seat.
    renderBoard(state());

    expect(screen.queryByText(/reconnect/i)).not.toBeInTheDocument();
  });

  it('stops saying it once their move is in — the round is not waiting on them', () => {
    renderBoard(state({ oppConnected: false, submitted: [OPP_PLAYER] }));

    expect(screen.queryByText(/Waiting for Grace/)).not.toBeInTheDocument();
    // Their seat still shows they are away; the round just isn't blocked on it.
    expect(screen.getByText('reconnecting…')).toBeInTheDocument();
  });
});

describe('resuming from the game’s own origin', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ state: state(), you: { playerId: MY_PLAYER, seatKey: MY_SEAT, name: 'Ada' }, reclaimed: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks the game, not Lobby, and sends the binding cookie with it', async () => {
    const result = await api.resume();

    expect(result.you.playerId).toBe(MY_PLAYER);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/resume');
    // Without `include` the browser withholds the cookie in dev, where the
    // client and API share a site but not an origin.
    expect(init.credentials).toBe('include');
    // No Authorization header: this path carries no seat token at all.
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('surfaces "nothing to resume" as a rejection the caller can ignore', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'no seat binding' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(api.resume()).rejects.toThrow('no seat binding');
  });
});
