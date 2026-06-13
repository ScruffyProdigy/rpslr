import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { exportJWK, generateKeyPair, SignJWT, type JWK, type KeyLike } from 'jose';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { MemoryGameRepository } from './memoryRepository.js';
import { GameService } from './service.js';
import { createTokenVerifier, IssuerJwksTokenVerifier } from './tokens.js';

const AUDIENCE = 'http://localhost:3001';
const OLD_KID = 'lobby-key-old';
const NEW_KID = 'lobby-key-new';

type SigningMaterial = {
  kid: string;
  privateKey: KeyLike;
  publicJwk: JWK;
};

async function generateSigningKey(kid: string): Promise<SigningMaterial> {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA');
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = kid;
  publicJwk.alg = 'EdDSA';
  publicJwk.use = 'sig';
  return { kid, privateKey, publicJwk };
}

async function signSeatToken(
  key: SigningMaterial,
  opts: {
    issuer: string;
    matchId: string;
    seatKey: string;
    sub: string;
    name?: string;
  },
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    matchId: opts.matchId,
    seatKey: opts.seatKey,
    ...(opts.name ? { name: opts.name } : {}),
  })
    .setProtectedHeader({ alg: 'EdDSA', kid: key.kid })
    .setIssuer(opts.issuer)
    .setAudience(AUDIENCE)
    .setSubject(opts.sub)
    .setJti(crypto.randomUUID())
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(now + 3600)
    .sign(key.privateKey);
}

/** Minimal Lobby JWKS stand-in; keys can be swapped mid-test to simulate rotation. */
class MockLobbyJwksServer {
  private server: http.Server | null = null;
  private publishedKeys: JWK[] = [];
  issuer = '';

  setKeys(keys: JWK[]) {
    this.publishedKeys = keys;
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server = http.createServer((req, res) => {
        if (req.url === '/.well-known/jwks.json') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ keys: this.publishedKeys }));
          return;
        }
        res.writeHead(404);
        res.end();
      });
      this.server!.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address();
        if (!addr || typeof addr === 'string') {
          throw new Error('mock JWKS server failed to bind');
        }
        this.issuer = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) => {
      this.server!.close((err) => (err ? reject(err) : resolve()));
    });
    this.server = null;
  }
}

const activeServers: MockLobbyJwksServer[] = [];

afterEach(async () => {
  while (activeServers.length > 0) {
    await activeServers.pop()?.stop();
  }
});

async function startMockLobby(keys: JWK[]): Promise<MockLobbyJwksServer> {
  const mock = new MockLobbyJwksServer();
  mock.setKeys(keys);
  await mock.start();
  activeServers.push(mock);
  return mock;
}

describe('JWKS key rotation (kid matching)', () => {
  it('verifies seat tokens signed with either key while both are in JWKS', async () => {
    const oldKey = await generateSigningKey(OLD_KID);
    const newKey = await generateSigningKey(NEW_KID);
    const lobby = await startMockLobby([oldKey.publicJwk, newKey.publicJwk]);

    const verifier = new IssuerJwksTokenVerifier([AUDIENCE]);
    const base = {
      issuer: lobby.issuer,
      matchId: 'rotation-overlap',
      seatKey: '1',
      sub: '11111111-1111-4111-8111-111111111111',
    };

    const oldToken = await signSeatToken(oldKey, base);
    const newToken = await signSeatToken(newKey, { ...base, seatKey: '2', sub: '22222222-2222-4222-8222-222222222222' });

    await expect(verifier.verify(oldToken)).resolves.toMatchObject({
      lobbyIssuer: lobby.issuer,
      externalMatchId: 'rotation-overlap',
      seatKey: '1',
    });
    await expect(verifier.verify(newToken)).resolves.toMatchObject({
      externalMatchId: 'rotation-overlap',
      seatKey: '2',
    });
  });

  it('rejects tokens signed with a retired key after it is removed from JWKS', async () => {
    const oldKey = await generateSigningKey(OLD_KID);
    const newKey = await generateSigningKey(NEW_KID);
    const lobby = await startMockLobby([oldKey.publicJwk, newKey.publicJwk]);

    const retiredToken = await signSeatToken(oldKey, {
      issuer: lobby.issuer,
      matchId: 'rotation-retired',
      seatKey: '1',
      sub: '11111111-1111-4111-8111-111111111111',
    });

    // Overlap: old token still valid.
    const overlapVerifier = new IssuerJwksTokenVerifier([AUDIENCE]);
    await expect(overlapVerifier.verify(retiredToken)).resolves.toBeDefined();

    // Rotation complete: JWKS publishes only the new key (fresh verifier ≈ new JWKS fetch).
    lobby.setKeys([newKey.publicJwk]);
    const postRotationVerifier = new IssuerJwksTokenVerifier([AUDIENCE]);
    await expect(postRotationVerifier.verify(retiredToken)).rejects.toThrow(/invalid lobby token/);

    const freshToken = await signSeatToken(newKey, {
      issuer: lobby.issuer,
      matchId: 'rotation-retired',
      seatKey: '2',
      sub: '22222222-2222-4222-8222-222222222222',
    });
    await expect(postRotationVerifier.verify(freshToken)).resolves.toMatchObject({
      seatKey: '2',
    });
  });

  it('claims a seat using tokens from either signing key during overlap', async () => {
    const oldKey = await generateSigningKey(OLD_KID);
    const newKey = await generateSigningKey(NEW_KID);
    const lobby = await startMockLobby([oldKey.publicJwk, newKey.publicJwk]);

    const matchId = 'lobby-jwks-rotation';
    const config = loadConfig({ GAME_APP_ENV: 'local', REQUIRE_LOBBY_AUTH: 'false' } as NodeJS.ProcessEnv);
    const service = new GameService(new MemoryGameRepository());
    const app = createApp(service, config, createTokenVerifier([AUDIENCE]));

    const pushed = await request(app)
      .post('/api/v1/matches')
      .set('Authorization', 'Bearer lobby-svc-secret')
      .send({
        lobbyId: lobby.issuer,
        lobby: {
          returnUrl: `${lobby.issuer}/return`,
          graphqlUrl: `${lobby.issuer}/graphql`,
          serviceToken: 'lobby-svc-secret',
        },
        assignment: {
          externalMatchId: matchId,
          gameMode: 'duel',
          seats: [
            { seatKey: '1', lobbyUserId: '11111111-1111-4111-8111-111111111111' },
            { seatKey: '2', lobbyUserId: '22222222-2222-4222-8222-222222222222' },
          ],
        },
      });
    expect(pushed.status).toBe(201);

    const aliceToken = await signSeatToken(oldKey, {
      issuer: lobby.issuer,
      matchId,
      seatKey: '1',
      sub: '11111111-1111-4111-8111-111111111111',
      name: 'Alice',
    });
    const alice = await request(app)
      .post(`/api/v1/matches/${matchId}/claim`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({});
    expect(alice.status).toBe(201);
    expect(alice.body.you.seatKey).toBe('1');

    const bobToken = await signSeatToken(newKey, {
      issuer: lobby.issuer,
      matchId,
      seatKey: '2',
      sub: '22222222-2222-4222-8222-222222222222',
      name: 'Bob',
    });
    const bob = await request(app)
      .post(`/api/v1/matches/${matchId}/claim`)
      .set('Authorization', `Bearer ${bobToken}`)
      .send({});
    expect(bob.status).toBe(201);
    expect(bob.body.you.seatKey).toBe('2');
    expect(bob.body.state.match.status).toBe('playing');
  });
});
