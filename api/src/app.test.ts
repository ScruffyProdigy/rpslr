import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';
import { prequeueFixture, serialize } from './fixtures.testutil.js';
import { loadConfig } from './config.js';
import { MemoryGameRepository } from './memoryRepository.js';
import { GameService } from './service.js';
import { TokenError, type AssignmentClaims, type TokenVerifier } from './tokens.js';

const LOBBY_ENDPOINTS = {
  returnUrl: 'https://joinquest.cc',
  graphqlUrl: 'https://joinquest.cc/graphql',
  serviceToken: 'lobby-svc-secret',
};

function lobbyProvisionAuth(token: string | undefined = LOBBY_ENDPOINTS.serviceToken) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function buildApp(env: Partial<NodeJS.ProcessEnv> = {}, verifier?: TokenVerifier) {
  const config = loadConfig({ GAME_APP_ENV: 'local', REQUIRE_LOBBY_AUTH: 'false', ...env } as NodeJS.ProcessEnv);
  const service = new GameService(new MemoryGameRepository(), {
    bannedLobbyUsers: config.bannedLobbyUsers,
  });
  return createApp(service, config, verifier);
}

/** Fake verifier: maps a token string to canned claims (no JWKS needed). */
function fakeVerifier(map: Record<string, AssignmentClaims>): TokenVerifier {
  return {
    async verify(token: string) {
      const claims = map[token];
      if (!claims) throw new TokenError('invalid lobby token');
      return claims;
    },
  };
}

describe('platform routes', () => {
  it('GET /healthz returns ok', async () => {
    const res = await request(buildApp()).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.text).toBe('ok');
  });

  it('GET /api/v1/status returns metadata', async () => {
    const res = await request(buildApp()).get('/api/v1/status');
    expect(res.body.game).toBe('rock-paper-scissors-lizard-robot');
    expect(res.body.version).toBe('0.2.0');
    expect(res.body.standalone).toBe(true);
    expect(res.body.launchUrlsOnProvision).toBe(true);
  });

  it('GET /api/v1/game-modes publishes a Lobby-compatible manifest', async () => {
    const res = await request(buildApp()).get('/api/v1/game-modes');
    expect(res.status).toBe(200);
    expect(res.body.game).toBe('rock-paper-scissors-lizard-robot');
    const duel = res.body.modes.find((m: { key: string }) => m.key === 'duel');
    expect(duel).toMatchObject({
      displayName: '1v1 Duel',
      minPlayers: 2,
      maxPlayers: 2,
    });
    expect(duel).not.toHaveProperty('bestOf');
    expect(duel.seatTemplate).toEqual({ count: 2 });
  });
});

describe('standalone create → claim → move', () => {
  it('plays a full match over HTTP', async () => {
    const app = buildApp();
    const created = await request(app)
      .post('/api/v1/matches')
      .send({ name: 'API Match', hostName: 'Alice', bestOf: 1 });
    expect(created.status).toBe(201);
    const code = created.body.state.match.code;
    const hostId = created.body.you.playerId;

    const joined = await request(app).post(`/api/v1/matches/${code}/claim`).send({ playerName: 'Bob' });
    expect(joined.status).toBe(201);
    expect(joined.body.you.seatKey).toBe('2'); // auto-picked the open seat
    const challengerId = joined.body.you.playerId;

    await request(app).post(`/api/v1/matches/${code}/move`).send({ playerId: hostId, move: 'rock' });
    const final = await request(app)
      .post(`/api/v1/matches/${code}/move`)
      .send({ playerId: challengerId, move: 'scissors' });

    expect(final.status).toBe(200);
    expect(final.body.match.status).toBe('finished');
    expect(final.body.matchWinnerSeatKey).toBe('1');
  });

  it('returns 404 for an unknown match', async () => {
    const res = await request(buildApp()).get('/api/v1/matches/RPS-NOPE');
    expect(res.status).toBe(404);
  });

  it('returns 400 when a move is missing playerId', async () => {
    const app = buildApp();
    const created = await request(app).post('/api/v1/matches').send({ hostName: 'Alice' });
    const code = created.body.state.match.code;
    const res = await request(app).post(`/api/v1/matches/${code}/move`).send({ move: 'rock' });
    expect(res.status).toBe(400);
  });
});

describe('Lobby push + signed-token claim (option 2)', () => {
  const push = {
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

  it('rejects provision with no Authorization header when serviceToken is configured', async () => {
    const app = buildApp();
    const body = {
      lobbyId: 'https://joinquest.cc',
      lobby: LOBBY_ENDPOINTS,
      assignment: {
        externalMatchId: 'missing-auth-test',
        gameMode: 'duel',
        seats: [{ seatKey: '1', lobbyUserId: 'u1' }],
      },
    };
    const noHeader = await request(app).post('/api/v1/matches').send(body);
    expect(noHeader.status).toBe(401);

    const wrongHeader = await request(app)
      .post('/api/v1/matches')
      .set('Authorization', 'Bearer wrong-token')
      .send(body);
    expect(wrongHeader.status).toBe(401);
  });

  it('accepts idempotent re-provision for the same externalMatchId', async () => {
    const app = buildApp();
    const body = {
      lobbyId: 'https://joinquest.cc',
      lobby: LOBBY_ENDPOINTS,
      assignment: {
        externalMatchId: 'idempotent-test',
        gameMode: 'duel',
        seats: [
          { seatKey: '1', lobbyUserId: '11111111-1111-4111-8111-111111111111' },
          { seatKey: '2', lobbyUserId: '22222222-2222-4222-8222-222222222222' },
        ],
      },
    };
    const first = await request(app).post('/api/v1/matches').set(lobbyProvisionAuth()).send(body);
    expect(first.status).toBe(201);

    const second = await request(app).post('/api/v1/matches').set(lobbyProvisionAuth()).send(body);
    expect(second.status).toBe(201);
    expect(second.body.match.externalMatchId).toBe('idempotent-test');
    expect(second.body.launchUrls['11111111-1111-4111-8111-111111111111']).toContain('seat=1');
  });

  it('accepts Lobby provision envelope without bestOf or seat displayName', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/v1/matches')
      .set(lobbyProvisionAuth())
      .send({
        lobbyId: 'https://joinquest.cc',
        lobby: LOBBY_ENDPOINTS,
        assignment: {
          externalMatchId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          gameMode: 'duel',
          seats: [
            { seatKey: '1', lobbyUserId: '11111111-1111-4111-8111-111111111111' },
            { seatKey: '2', lobbyUserId: '22222222-2222-4222-8222-222222222222' },
          ],
        },
      });
    expect(res.status).toBe(201);
    expect(res.body.match.externalMatchId).toBe('f47ac10b-58cc-4372-a567-0e02b2c3d479');
    expect(res.body.launchUrls['11111111-1111-4111-8111-111111111111']).toContain('match=f47ac10b-58cc-4372-a567-0e02b2c3d479');
    expect(res.body.launchUrls['22222222-2222-4222-8222-222222222222']).toContain('seat=2');
    expect(res.body.match.bestOf).toBe(5);
    expect(res.body.match.lobbyId).toBe('https://joinquest.cc');
    expect(res.body.match.lobbyReturnUrl).toBe('https://joinquest.cc');
    expect(res.body.match.lobbyGraphqlUrl).toBe('https://joinquest.cc/graphql');
    expect(res.body.match.lobbyServiceToken).toBe('lobby-svc-secret');
  });

  it('provisions via push, then seats each user from their token', async () => {
    const verifier = fakeVerifier({
      'tok-alice': {
        lobbyIssuer: 'https://joinquest.cc',
        lobbyUserId: 'u_alice',
        externalMatchId: 'lobby-xyz',
        seatKey: '1',
        displayName: 'Alice',
      },
      'tok-bob': {
        lobbyIssuer: 'https://joinquest.cc',
        lobbyUserId: 'u_bob',
        externalMatchId: 'lobby-xyz',
        seatKey: '2',
        displayName: 'Bob',
      },
    });
    const app = buildApp({}, verifier);

    const pushed = await request(app).post('/api/v1/matches').set(lobbyProvisionAuth()).send(push);
    expect(pushed.status).toBe(201);
    expect(pushed.body.match.externalMatchId).toBe('lobby-xyz');

    const alice = await request(app)
      .post('/api/v1/matches/lobby-xyz/claim')
      .set('Authorization', 'Bearer tok-alice')
      .send({});
    expect(alice.status).toBe(201);
    expect(alice.body.you.seatKey).toBe('1');
    expect(alice.body.you.name).toBe('Alice');

    const bob = await request(app)
      .post('/api/v1/matches/lobby-xyz/claim')
      .set('Authorization', 'Bearer tok-bob')
      .send({});
    expect(bob.body.you.seatKey).toBe('2');
    expect(bob.body.state.match.status).toBe('playing');
  });

  it('rejects a push with a banned player (403 + ids) so Lobby can correct', async () => {
    const app = buildApp({ BANNED_LOBBY_USERS: 'u_bob' });
    const res = await request(app).post('/api/v1/matches').set(lobbyProvisionAuth()).send(push);
    expect(res.status).toBe(403);
    expect(res.body.bannedLobbyUserIds).toContain('u_bob');
  });

  it('rejects claim when token iss does not match lobbyId on the match', async () => {
    const verifier = fakeVerifier({
      'tok-bad': {
        lobbyIssuer: 'https://wrong.example',
        lobbyUserId: 'u_alice',
        externalMatchId: 'lobby-xyz',
        seatKey: '1',
      },
    });
    const app = buildApp({}, verifier);
    await request(app).post('/api/v1/matches').set(lobbyProvisionAuth()).send(push);
    const res = await request(app)
      .post('/api/v1/matches/lobby-xyz/claim')
      .set('Authorization', 'Bearer tok-bad')
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/iss/);
  });

  it('refuses a token claim when the match was never pushed', async () => {
    const verifier = fakeVerifier({
      'tok-alice': {
        lobbyIssuer: 'https://joinquest.cc',
        lobbyUserId: 'u_alice',
        externalMatchId: 'ghost',
        seatKey: '1',
      },
    });
    const app = buildApp({}, verifier);
    const res = await request(app)
      .post('/api/v1/matches/ghost/claim')
      .set('Authorization', 'Bearer tok-alice')
      .send({});
    expect(res.status).toBe(404);
  });

  it('returns 404 when claim URL does not match the token matchId', async () => {
    const verifier = fakeVerifier({
      'tok-alice': {
        lobbyIssuer: 'https://joinquest.cc',
        lobbyUserId: 'u_alice',
        externalMatchId: 'lobby-xyz',
        seatKey: '1',
        displayName: 'Alice',
      },
    });
    const app = buildApp({}, verifier);
    await request(app).post('/api/v1/matches').set(lobbyProvisionAuth()).send(push);

    const res = await request(app)
      .post('/api/v1/matches/lobby-check-missing-other-id/claim')
      .set('Authorization', 'Bearer tok-alice')
      .send({});
    expect(res.status).toBe(404);
  });

  it('rejects claim when token seatKey does not match the reserved seat', async () => {
    const verifier = fakeVerifier({
      'tok-wrong-seat': {
        lobbyIssuer: 'https://joinquest.cc',
        lobbyUserId: 'u_alice',
        externalMatchId: 'lobby-xyz',
        seatKey: '2',
        displayName: 'Alice',
      },
    });
    const app = buildApp({}, verifier);
    await request(app).post('/api/v1/matches').set(lobbyProvisionAuth()).send(push);

    const res = await request(app)
      .post('/api/v1/matches/lobby-xyz/claim')
      .set('Authorization', 'Bearer tok-wrong-seat')
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/reserved/);
  });

  it('rejects malformed and expired lobby tokens', async () => {
    const verifier: TokenVerifier = {
      async verify(token: string) {
        if (token === 'tok-expired') throw new TokenError('token expired');
        throw new TokenError('invalid lobby token');
      },
    };
    const app = buildApp({}, verifier);
    await request(app).post('/api/v1/matches').set(lobbyProvisionAuth()).send(push);

    const expired = await request(app)
      .post('/api/v1/matches/lobby-xyz/claim')
      .set('Authorization', 'Bearer tok-expired')
      .send({});
    expect(expired.status).toBe(401);

    const invalid = await request(app)
      .post('/api/v1/matches/lobby-xyz/claim')
      .set('Authorization', 'Bearer not-a-jwt')
      .send({});
    expect(invalid.status).toBe(401);
  });

  it('requires a token when REQUIRE_LOBBY_AUTH=true', async () => {
    const app = buildApp({ REQUIRE_LOBBY_AUTH: 'true' });
    const res = await request(app).post('/api/v1/matches/whatever/claim').send({ playerName: 'X' });
    expect(res.status).toBe(401);
  });
});

// --- Pre-queue options (JQ-148) --------------------------------------------
// The fixtures under docs/fixtures/prequeue are the contract's specification, so
// these tests load them rather than restating what they say.

describe('GET /api/v1/players/:lobbyUserId/queue-options', () => {
  it('serves the full helper roster for duel-helpers', async () => {
    const res = await request(buildApp()).get('/api/v1/players/u_1/queue-options').query({
      modeKey: 'duel-helpers',
    });
    expect(res.status).toBe(200);
    expect(serialize(res.body)).toBe(serialize(prequeueFixture('queue-options.duel-helpers')));
  });

  it('carries id, label, section, badge, description, load and locked on every choice', async () => {
    const res = await request(buildApp())
      .get('/api/v1/players/u_1/queue-options')
      .query({ modeKey: 'duel-helpers' });
    for (const choice of res.body.choices) {
      expect(Object.keys(choice)).toEqual([
        'id',
        'label',
        'section',
        'badge',
        'description',
        // JQ-237: whether this card carries a charge, and on what clock. Zero-load
        // stopped being something a tier could promise once a Minor could fire.
        'load',
        'locked',
      ]);
      expect(choice.locked).toBe(false);
      expect(choice.load.kind).toMatch(/^(passive|ability)$/);
    }
  });

  it('serves the same roster to every player — no progression', async () => {
    const app = buildApp();
    const one = await request(app).get('/api/v1/players/u_1/queue-options').query({
      modeKey: 'duel-helpers',
    });
    const two = await request(app).get('/api/v1/players/someone-else/queue-options').query({
      modeKey: 'duel-helpers',
    });
    expect(two.body).toEqual(one.body);
  });

  it('answers 200 with an empty roster for a mode that asks nothing, not 404', async () => {
    const res = await request(buildApp())
      .get('/api/v1/players/u_1/queue-options')
      .query({ modeKey: 'duel' });
    expect(res.status).toBe(200);
    expect(serialize(res.body)).toBe(serialize(prequeueFixture('queue-options.duel')));
  });

  it('404s a mode this game does not serve', async () => {
    const res = await request(buildApp())
      .get('/api/v1/players/u_1/queue-options')
      .query({ modeKey: 'nonesuch' });
    expect(res.status).toBe(404);
  });

  it('400s when modeKey is missing', async () => {
    const res = await request(buildApp()).get('/api/v1/players/u_1/queue-options');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/matches with pre-queue options', () => {
  type ProvisionFixture = {
    request: Record<string, unknown>;
    expect: { status: number; seatKey?: string; reason?: string };
  };

  async function provision(fixture: ProvisionFixture, env: Partial<NodeJS.ProcessEnv> = {}) {
    return request(buildApp(env)).post('/api/v1/matches').send(fixture.request);
  }

  for (const name of [
    'duplicate-helper',
    'unknown-helper',
    'wrong-arity',
    'missing-options',
  ] as const) {
    it(`rejects ${name} with the fixture's status, seat and reason`, async () => {
      const fixture = prequeueFixture<ProvisionFixture>(`provision.${name}`);
      const res = await provision(fixture);
      expect(res.status).toBe(fixture.expect.status);
      expect(res.body.error).toBe('invalid pre-queue selection');
      expect(res.body.seatKey).toBe(fixture.expect.seatKey);
      expect(res.body.reason).toContain(fixture.expect.reason);
    });
  }

  it('rejects with 400 and never 403, which Lobby reads as the banlist handshake', async () => {
    const fixture = prequeueFixture<ProvisionFixture>('provision.duplicate-helper');
    const res = await provision(fixture);
    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty('bannedLobbyUserIds');
  });

  it('accepts a valid selection and provisions the match', async () => {
    const fixture = prequeueFixture<ProvisionFixture>('provision.valid');
    const res = await provision(fixture);
    expect(res.status).toBe(201);
    expect(res.body.match.gameMode).toBe('duel-helpers');
    expect(res.body.seats).toHaveLength(2);
  });

  it('ignores the labels Lobby cached — they are display strings, not identity', async () => {
    const fixture = prequeueFixture<ProvisionFixture>('provision.valid');
    const assignment = (fixture.request.assignment as { seats: Record<string, unknown>[] });
    const relabelled = {
      ...fixture.request,
      assignment: {
        ...assignment,
        externalMatchId: 'fixture-valid-relabelled',
        seats: assignment.seats.map((seat) => ({
          ...seat,
          options: (seat.options as { groupKey: string; optionIds: string[] }[]).map((o) => ({
            ...o,
            labels: ['Not', 'A Helper Name'],
          })),
        })),
      },
    };
    const res = await request(buildApp()).post('/api/v1/matches').send(relabelled);
    expect(res.status).toBe(201);
  });

  it('never invents a loadout for a seat that picked nothing', async () => {
    const fixture = prequeueFixture<ProvisionFixture>('provision.missing-options');
    const res = await provision(fixture);
    expect(res.status).toBe(400);
    // The old default was Ferrus + Featherweight. Nothing should reach for it.
    expect(JSON.stringify(res.body)).not.toContain('featherweight');
  });

  it('leaves duel provisioning untouched', async () => {
    const res = await request(buildApp())
      .post('/api/v1/matches')
      .send({
        lobbyId: 'https://lobby.local',
        lobby: { returnUrl: 'http://localhost:5173', graphqlUrl: 'http://localhost:8080/query' },
        assignment: {
          externalMatchId: 'plain-duel',
          gameMode: 'duel',
          bestOf: 5,
          seats: [
            { seatKey: '1', lobbyUserId: 'u_1' },
            { seatKey: '2', lobbyUserId: 'u_2' },
          ],
        },
      });
    expect(res.status).toBe(201);
  });
});
