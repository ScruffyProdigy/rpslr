/**
 * Getting back into a match you are already in.
 *
 * Two independent paths, and they are independent on purpose — each one works
 * when the other has failed:
 *
 *   Path 1  the game's own browser → seat binding (`GET /resume`, no token)
 *   Path 2  Lobby's Rejoin button, which mints a fresh seat token and lands on
 *           the re-claim rule (`POST /claim` → `200`, not `409`)
 *
 * @see docs/lobby-protocol-handoff.md#reconnecting-a-player
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { MemoryGameRepository } from './memoryRepository.js';
import { PresenceTracker } from './presence.js';
import { SEAT_BINDING_COOKIE, decodeSeatBinding, encodeSeatBinding } from './seatBinding.js';
import { GameService } from './service.js';
import { TokenError, type AssignmentClaims, type TokenVerifier } from './tokens.js';

/**
 * Lobby callbacks are fire-and-forget, so a test that ends a match would
 * otherwise reach the real joinquest.cc. Every GraphQL body sent while a test
 * runs lands here instead.
 */
let lobbyCalls: string[] = [];

beforeEach(() => {
  lobbyCalls = [];
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    lobbyCalls.push(String(init?.body ?? ''));
    return new Response(
      JSON.stringify({ data: { reportMatchResult: true, reportPlayerFinished: true } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The GraphQL bodies the game sent Lobby, parsed. */
function lobbyMutations(name: string): { query: string; variables: Record<string, unknown> }[] {
  return lobbyCalls
    .filter((body) => body.includes(name))
    .map((body) => JSON.parse(body) as { query: string; variables: Record<string, unknown> });
}

const LOBBY_ENDPOINTS = {
  returnUrl: 'https://joinquest.cc',
  graphqlUrl: 'https://joinquest.cc/graphql',
  serviceToken: 'lobby-svc-secret',
};

const PUSH = {
  lobbyId: 'https://joinquest.cc',
  lobby: LOBBY_ENDPOINTS,
  assignment: {
    externalMatchId: 'lobby-xyz',
    gameMode: 'duel',
    seats: [
      { seatKey: '1', lobbyUserId: 'u_alice', displayName: 'Alice' },
      { seatKey: '2', lobbyUserId: 'u_bob', displayName: 'Bob' },
    ],
  },
};

function claims(lobbyUserId: string, seatKey: string, displayName: string): AssignmentClaims {
  return {
    lobbyIssuer: 'https://joinquest.cc',
    lobbyUserId,
    externalMatchId: 'lobby-xyz',
    seatKey,
    displayName,
  };
}

/** Alice and Bob hold seats 1 and 2; Mallory holds a token for Alice's seat. */
const VERIFIER: TokenVerifier = {
  async verify(token: string) {
    const map: Record<string, AssignmentClaims> = {
      'tok-alice': claims('u_alice', '1', 'Alice'),
      // The Rejoin button mints a *fresh* token for the seat she still holds.
      'tok-alice-rejoin': claims('u_alice', '1', 'Alice'),
      'tok-bob': claims('u_bob', '2', 'Bob'),
      'tok-mallory': claims('u_mallory', '1', 'Mallory'),
    };
    const found = map[token];
    if (!found) throw new TokenError('invalid lobby token');
    return found;
  },
};

function buildApp() {
  const config = loadConfig({
    GAME_APP_ENV: 'local',
    REQUIRE_LOBBY_AUTH: 'true',
  } as NodeJS.ProcessEnv);
  const service = new GameService(new MemoryGameRepository(), {
    bannedLobbyUsers: config.bannedLobbyUsers,
  });
  return createApp(service, config, VERIFIER);
}

/** Provision the match and seat both players, as a Lobby launch does. */
async function seatedMatch() {
  const app = buildApp();
  await request(app)
    .post('/api/v1/matches')
    .set('Authorization', `Bearer ${LOBBY_ENDPOINTS.serviceToken}`)
    .send(PUSH);
  const alice = await request(app)
    .post('/api/v1/matches/lobby-xyz/claim')
    .set('Authorization', 'Bearer tok-alice')
    .send({});
  const bob = await request(app)
    .post('/api/v1/matches/lobby-xyz/claim')
    .set('Authorization', 'Bearer tok-bob')
    .send({});
  return { app, alice, bob };
}

/** The binding cookie the API set, in the form a browser would send it back. */
function bindingCookieFrom(res: request.Response): string {
  const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
  const header = (setCookie ?? []).find((c) => c.startsWith(`${SEAT_BINDING_COOKIE}=`));
  if (!header) throw new Error('claim set no seat binding cookie');
  return header.split(';')[0];
}

describe('re-claiming your own seat', () => {
  it('answers a first claim 201 and the same player coming back 200', async () => {
    const { app, alice } = await seatedMatch();
    expect(alice.status).toBe(201);
    expect(alice.body.reclaimed).toBe(false);

    const again = await request(app)
      .post('/api/v1/matches/lobby-xyz/claim')
      .set('Authorization', 'Bearer tok-alice-rejoin')
      .send({});

    expect(again.status).toBe(200);
    expect(again.body.reclaimed).toBe(true);
    expect(again.body.you.playerId).toBe(alice.body.you.playerId);
    expect(again.body.you.seatKey).toBe('1');
  });

  it('still refuses a different player reaching for an occupied seat', async () => {
    const { app } = await seatedMatch();

    const theft = await request(app)
      .post('/api/v1/matches/lobby-xyz/claim')
      .set('Authorization', 'Bearer tok-mallory')
      .send({});

    expect(theft.status).toBe(409);
    expect(theft.body.error).toMatch(/already taken/);
  });

  it('leaves the match exactly where it was — no reset, no re-deal, no throw cleared', async () => {
    const { app, alice, bob } = await seatedMatch();
    // Alice throws, then loses her tab before Bob answers. Her move is committed
    // and the round is live; coming back must not undo either.
    await request(app)
      .post('/api/v1/matches/lobby-xyz/move')
      .send({ playerId: alice.body.you.playerId, move: 'rock', round: 1 });

    const before = await request(app).get(`/api/v1/matches/lobby-xyz?playerId=${alice.body.you.playerId}`);

    const again = await request(app)
      .post('/api/v1/matches/lobby-xyz/claim')
      .set('Authorization', 'Bearer tok-alice-rejoin')
      .send({});

    expect(again.status).toBe(200);
    const state = again.body.state;
    expect(state.match.status).toBe('playing');
    expect(state.match.currentRound).toBe(1);
    expect(state.match.currentRound).toBe(before.body.match.currentRound);
    // The throw she already made is still hers, and still hidden from Bob.
    expect(state.currentRoundMoves[alice.body.you.playerId]).toBe('rock');
    expect(state.submittedPlayerIds).toEqual([alice.body.you.playerId]);
    // The round clock was not restarted under her.
    expect(state.match.phase).toBe(before.body.match.phase);
    expect(state.match.phaseStartedAt).toBe(before.body.match.phaseStartedAt);
    expect(state.match.phaseDeadline).toBe(before.body.match.phaseDeadline);
    // Nobody joined twice: two seats, two players, the same two ids.
    expect(state.seats.map((s: { player: { id: string } }) => s.player.id)).toEqual([
      alice.body.you.playerId,
      bob.body.you.playerId,
    ]);
    // And no seat was re-dealt.
    expect(state.seats.map((s: { loadout: unknown }) => s.loadout)).toEqual(
      before.body.seats.map((s: { loadout: unknown }) => s.loadout),
    );
  });

  it('answers a re-claim with the full authoritative snapshot, not a delta', async () => {
    const { app, alice, bob } = await seatedMatch();
    await request(app)
      .post('/api/v1/matches/lobby-xyz/move')
      .send({ playerId: alice.body.you.playerId, move: 'rock', round: 1 });
    await request(app)
      .post('/api/v1/matches/lobby-xyz/move')
      .send({ playerId: bob.body.you.playerId, move: 'scissors', round: 1 });

    const again = await request(app)
      .post('/api/v1/matches/lobby-xyz/claim')
      .set('Authorization', 'Bearer tok-alice-rejoin')
      .send({});

    // Everything she missed is in the answer she gets, not implied by it.
    expect(again.body.state.results).toHaveLength(1);
    expect(again.body.state.results[0].outcome).toBe('1');
    expect(again.body.state.seats).toHaveLength(2);
    expect(again.body.state.match.currentRound).toBe(2);
  });
});

describe('recovery from the game’s own origin', () => {
  it('records browser → seat on a successful claim', async () => {
    const { alice } = await seatedMatch();
    const cookie = bindingCookieFrom(alice);
    const binding = decodeSeatBinding(cookie.split('=').slice(1).join('='));

    expect(binding).toEqual({
      externalMatchId: 'lobby-xyz',
      seatKey: '1',
      lobbyUserId: 'u_alice',
      playerId: alice.body.you.playerId,
    });
  });

  it('resumes a player with no token at all', async () => {
    const { app, alice } = await seatedMatch();

    const resumed = await request(app)
      .get('/api/v1/resume')
      .set('Cookie', bindingCookieFrom(alice));

    expect(resumed.status).toBe(200);
    expect(resumed.body.you.playerId).toBe(alice.body.you.playerId);
    expect(resumed.body.you.seatKey).toBe('1');
    expect(resumed.body.state.match.externalMatchId).toBe('lobby-xyz');
  });

  it('resumes into live state, mid-round, with the throw still committed', async () => {
    const { app, alice } = await seatedMatch();
    await request(app)
      .post('/api/v1/matches/lobby-xyz/move')
      .send({ playerId: alice.body.you.playerId, move: 'paper', round: 1 });

    const resumed = await request(app)
      .get('/api/v1/resume')
      .set('Cookie', bindingCookieFrom(alice));

    expect(resumed.body.state.currentRoundMoves[alice.body.you.playerId]).toBe('paper');
    expect(resumed.body.state.match.currentRound).toBe(1);
  });

  it('resumes nothing without a binding', async () => {
    const { app } = await seatedMatch();
    const res = await request(app).get('/api/v1/resume');
    expect(res.status).toBe(404);
  });

  it('checks the binding against the match rather than trusting it', async () => {
    const { app, alice, bob } = await seatedMatch();

    // A binding naming someone else's player id in Alice's seat.
    const forged = encodeSeatBinding({
      externalMatchId: 'lobby-xyz',
      seatKey: '1',
      lobbyUserId: 'u_alice',
      playerId: bob.body.you.playerId,
    });
    const wrongPlayer = await request(app)
      .get('/api/v1/resume')
      .set('Cookie', `${SEAT_BINDING_COOKIE}=${forged}`);
    expect(wrongPlayer.status).toBe(404);

    // A binding naming Alice's real seat under someone else's `sub`.
    const impostor = encodeSeatBinding({
      externalMatchId: 'lobby-xyz',
      seatKey: '1',
      lobbyUserId: 'u_mallory',
      playerId: alice.body.you.playerId,
    });
    const wrongSub = await request(app)
      .get('/api/v1/resume')
      .set('Cookie', `${SEAT_BINDING_COOKIE}=${impostor}`);
    expect(wrongSub.status).toBe(404);

    // And a match that never existed.
    const ghost = encodeSeatBinding({
      externalMatchId: 'never-pushed',
      seatKey: '1',
      lobbyUserId: 'u_alice',
      playerId: alice.body.you.playerId,
    });
    const noMatch = await request(app)
      .get('/api/v1/resume')
      .set('Cookie', `${SEAT_BINDING_COOKIE}=${ghost}`);
    expect(noMatch.status).toBe(404);
  });

  it('resumes nothing from a seat in a finished match, and clears the binding', async () => {
    const { app, alice, bob } = await seatedMatch();
    // best-of-5: three straight wins for Alice ends it.
    for (const [mine, theirs] of [
      ['rock', 'scissors'],
      ['paper', 'rock'],
      ['scissors', 'paper'],
    ] as const) {
      await request(app)
        .post('/api/v1/matches/lobby-xyz/move')
        .send({ playerId: alice.body.you.playerId, move: mine });
      await request(app)
        .post('/api/v1/matches/lobby-xyz/move')
        .send({ playerId: bob.body.you.playerId, move: theirs });
    }
    const finished = await request(app).get('/api/v1/matches/lobby-xyz');
    expect(finished.body.match.status).toBe('finished');

    const res = await request(app).get('/api/v1/resume').set('Cookie', bindingCookieFrom(alice));

    expect(res.status).toBe(404);
    const cleared = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith(`${SEAT_BINDING_COOKIE}=`),
    );
    expect(cleared).toContain('Max-Age=0');
  });
});

describe('the two recovery paths fail independently', () => {
  it('gets a player with no game-origin binding back in through Rejoin', async () => {
    const { app, alice } = await seatedMatch();

    // A different browser profile: no cookie to present at all.
    const noBinding = await request(app).get('/api/v1/resume');
    expect(noBinding.status).toBe(404);

    // Lobby's Rejoin mints a fresh token for the seat she still holds.
    const rejoined = await request(app)
      .post('/api/v1/matches/lobby-xyz/claim')
      .set('Authorization', 'Bearer tok-alice-rejoin')
      .send({});
    expect(rejoined.status).toBe(200);
    expect(rejoined.body.you.playerId).toBe(alice.body.you.playerId);
  });

  it('gets a player whose lobby session is gone back in from the game’s own origin', async () => {
    const { app, alice } = await seatedMatch();

    // No token, and nothing that would make Lobby reachable — just the cookie.
    const resumed = await request(app)
      .get('/api/v1/resume')
      .set('Cookie', bindingCookieFrom(alice));

    expect(resumed.status).toBe(200);
    expect(resumed.body.you.playerId).toBe(alice.body.you.playerId);
  });
});


describe('a disconnect is not a finish', () => {
  const GRACE_MS = 45_000;
  let now = 1_000_000;
  let presence: PresenceTracker;
  let service: GameService;

  /** A Lobby-provisioned match, so the callbacks have somewhere to go. */
  async function provisionedMatch() {
    const state = await service.ensureMatchFromAssignment({
      lobbyId: 'https://joinquest.cc',
      lobby: LOBBY_ENDPOINTS,
      assignment: PUSH.assignment,
    });
    const alice = await service.claimSeat(state.match.id, {
      seatKey: '1',
      name: 'Alice',
      lobbyUserId: 'u_alice',
    });
    const bob = await service.claimSeat(state.match.id, {
      seatKey: '2',
      name: 'Bob',
      lobbyUserId: 'u_bob',
    });
    return { ref: state.match.id, alice: alice.you.playerId, bob: bob.you.playerId };
  }

  beforeEach(() => {
    now = 1_000_000;
    presence = new PresenceTracker(() => now);
    service = new GameService(new MemoryGameRepository(), {
      presence,
      now: () => now,
      rng: () => 0,
    });
  });

  it('holds the seat and tells the other player the game is waiting', async () => {
    const { ref, alice, bob } = await provisionedMatch();
    await service.markConnected(ref, alice);
    await service.markConnected(ref, bob);
    await service.markDisconnected(ref, alice);

    const asBob = await service.getState(ref, bob);
    const aliceSeat = asBob.seats.find((s) => s.player?.id === alice)!;
    expect(aliceSeat.player!.connected).toBe(false);
    // Her seat is still hers, and the match is still on.
    expect(aliceSeat.player!.id).toBe(alice);
    expect(asBob.match.status).toBe('playing');
    // Nothing was reported to Lobby: a dropped socket is not a finish.
    expect(lobbyMutations('reportPlayerFinished')).toHaveLength(0);
  });

  it('says she is back once she reconnects', async () => {
    const { ref, alice, bob } = await provisionedMatch();
    await service.markConnected(ref, alice);
    await service.markDisconnected(ref, alice);
    await service.markConnected(ref, alice);

    const asBob = await service.getState(ref, bob);
    expect(asBob.seats.find((s) => s.player?.id === alice)!.player!.connected).toBe(true);
  });

  it('reports her finished only when the grace period she was given runs out', async () => {
    const { ref, alice, bob } = await provisionedMatch();
    await service.markConnected(ref, alice);
    await service.markConnected(ref, bob);
    await service.markDisconnected(ref, alice);

    // Still inside the grace period: held, not finished.
    now += GRACE_MS - 1;
    expect((await service.getState(ref)).match.status).toBe('playing');
    expect(lobbyMutations('reportPlayerFinished')).toHaveLength(0);

    now += 2;
    const ended = await service.getState(ref);
    expect(ended.match.status).toBe('finished');
    expect(ended.match.endReason).toBe('forfeit-disconnect');

    await vi.waitFor(() => {
      expect(lobbyMutations('reportPlayerFinished')).toHaveLength(1);
    });
    const [reported] = lobbyMutations('reportPlayerFinished');
    expect(reported.variables).toMatchObject({
      matchId: 'lobby-xyz',
      lobbyUserId: 'u_alice',
      reason: 'DISCONNECT',
    });
  });

  it('calls a run of ignored deadlines a FORFEIT rather than a DISCONNECT', async () => {
    const { ref, alice, bob } = await provisionedMatch();
    // Both connected throughout — this is someone present and not playing.
    await service.markConnected(ref, alice);
    await service.markConnected(ref, bob);

    // Bob answers every round on time; Alice lets two deadlines pass in a row.
    await service.submitMove(ref, bob, 'rock');
    now += 60_001;
    await service.getState(ref); // first expiry: a move is picked for her
    await service.submitMove(ref, bob, 'paper');
    now += 23_201;
    const ended = await service.getState(ref);

    expect(ended.match.endReason).toBe('forfeit-strikes');
    await vi.waitFor(() => {
      expect(lobbyMutations('reportPlayerFinished')).toHaveLength(1);
    });
    expect(lobbyMutations('reportPlayerFinished')[0].variables).toMatchObject({
      lobbyUserId: 'u_alice',
      reason: 'FORFEIT',
    });
  });
});
