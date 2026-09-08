import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { MemoryGameRepository } from '../memoryRepository.js';
import { GameService } from '../service.js';
import { MAX_STORY_BYTES, pngSize } from './cardImage.js';
import { resetShellCache } from './clientTemplate.js';

const SHELL =
  '<!doctype html><html><head><title>RPSLR</title></head><body><script src="/assets/x.js"></script></body></html>';

const shellFetch = vi.fn(
  async () => new Response(SHELL, { status: 200, headers: { 'content-type': 'text/html' } }),
) as unknown as typeof fetch;

function buildApp(fetchImpl: typeof fetch = shellFetch) {
  resetShellCache();
  const config = loadConfig({
    GAME_APP_ENV: 'local',
    REQUIRE_LOBBY_AUTH: 'false',
    GAME_PLAY_URL: 'https://rpsls-duel.win',
  } as NodeJS.ProcessEnv);
  const service = new GameService(new MemoryGameRepository());
  return { app: createApp(service, config, undefined, { fetchImpl }), service };
}

/** Plays a standalone best-of-3 to a finish and returns its room code. */
async function finishedMatch(service: GameService): Promise<string> {
  const created = await service.createStandaloneMatch({ hostName: 'Ana', bestOf: 3 });
  const code = created.state.match.code;
  const joined = await service.claimSeat(code, { seatKey: '2', name: 'Ben' });
  await service.submitMove(code, created.you.playerId, 'rock');
  await service.submitMove(code, joined.you.playerId, 'scissors');
  await service.submitMove(code, created.you.playerId, 'paper');
  await service.submitMove(code, joined.you.playerId, 'rock');
  return code;
}

describe('GET /replay/:ref', () => {
  it('serves the SPA with the match in its head', async () => {
    const { app, service } = buildApp();
    const code = await finishedMatch(service);
    const res = await request(app).get(`/replay/${code}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('<script src="/assets/x.js"></script>');
    expect(res.text).toContain('og:title" content="Ana beat Ben 2–0 in RPSLR"');
    expect(res.text).toContain(`og:url" content="https://rpsls-duel.win/replay/${code}"`);
    expect(res.text).toContain(
      `og:image" content="https://rpsls-duel.win/api/v1/replay/${code}/card.png"`,
    );
    expect(res.text).toContain('twitter:card" content="summary_large_image"');
  });

  it('carries ?by= through to the image URL so the two cards cache apart', async () => {
    const { app, service } = buildApp();
    const code = await finishedMatch(service);
    const res = await request(app).get(`/replay/${code}?by=1`);
    expect(res.text).toContain('og:title" content="Ana wins 2–0!"');
    expect(res.text).toContain('card.png?by=1');
    expect(res.text).toContain(`og:url" content="https://rpsls-duel.win/replay/${code}?by=1"`);
  });

  it('answers a ref that does not exist with the generic card, not an error', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/replay/does-not-exist');
    expect(res.status).toBe(200);
    expect(res.text).toContain('RPSLR on JoinQuest');
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('answers even when the client service is unreachable', async () => {
    const dead = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const { app, service } = buildApp(dead);
    const code = await finishedMatch(service);
    const res = await request(app).get(`/replay/${code}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('og:title');
  });

  it('answers within a second even when the avatar host never replies', async () => {
    const stalling = vi.fn((url: string, init?: RequestInit) =>
      url.endsWith('/index.html')
        ? Promise.resolve(new Response(SHELL, { status: 200, headers: { 'content-type': 'text/html' } }))
        : new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
    ) as unknown as typeof fetch;
    const { app, service } = buildApp(stalling);
    const code = await finishedMatch(service);
    const started = Date.now();
    const res = await request(app).get(`/replay/${code}`);
    expect(res.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('GET /api/v1/replay/:ref/card.png', () => {
  it('renders a PNG of the right size, within the byte limit', async () => {
    const { app, service } = buildApp();
    const code = await finishedMatch(service);
    const res = await request(app).get(`/api/v1/replay/${code}/card.png`).responseType('blob');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.body.readUInt32BE(16)).toBe(1200);
    expect(res.body.readUInt32BE(20)).toBe(630);
    expect(res.body.byteLength).toBeLessThanOrEqual(300_000);
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('gives an unknown ref a generic card that platforms must not cache', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/v1/replay/nope/card.png').responseType('blob');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('no-store');
  });
});

describe('GET /replay/:ref/story.png', () => {
  it('hands back a 1080×1920 PNG for a finished match', async () => {
    const { app, service } = buildApp();
    const code = await finishedMatch(service);
    const res = await request(app).get(`/replay/${code}/story.png`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(pngSize(res.body)).toEqual({ width: 1080, height: 1920 });
    expect(res.body.byteLength).toBeLessThanOrEqual(MAX_STORY_BYTES);
  });

  it('caches a finished match immutably and an unfinished one not at all', async () => {
    const { app, service } = buildApp();
    const code = await finishedMatch(service);
    const done = await request(app).get(`/replay/${code}/story.png`);
    expect(done.headers['cache-control']).toContain('immutable');

    const live = await service.createStandaloneMatch({ hostName: 'Ana', bestOf: 3 });
    const open = await request(app).get(`/replay/${live.state.match.code}/story.png`);
    expect(open.status).toBe(200);
    expect(open.headers['cache-control']).toContain('no-store');
  });

  // The share sheet is already open by the time this is fetched. An error here
  // is a button that appears broken, so there is no error to be had.
  it('answers with a card rather than an error for an unknown ref', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/replay/RPS-NOPE/story.png');
    expect(res.status).toBe(200);
    expect(pngSize(res.body)).toEqual({ width: 1080, height: 1920 });
  });

  it('answers with a card when the database is gone', async () => {
    const { app, service } = buildApp();
    vi.spyOn(service, 'getState').mockRejectedValue(new Error('no database'));
    const res = await request(app).get('/replay/anything/story.png');
    expect(res.status).toBe(200);
    expect(pngSize(res.body)).toEqual({ width: 1080, height: 1920 });
  });

  it('draws the winner’s own card apart from the neutral one', async () => {
    const { app, service } = buildApp();
    const code = await finishedMatch(service);
    const mine = await request(app).get(`/replay/${code}/story.png?by=1`);
    const neutral = await request(app).get(`/replay/${code}/story.png`);
    expect(mine.status).toBe(200);
    expect(neutral.status).toBe(200);
    // Different headlines, so different pixels — and different cache entries.
    expect(mine.body.equals(neutral.body)).toBe(false);
  });

  it('does not swallow the replay page itself', async () => {
    const { app, service } = buildApp();
    const code = await finishedMatch(service);
    const page = await request(app).get(`/replay/${code}`);
    expect(page.headers['content-type']).toMatch(/text\/html/);
  });
});

describe('GET /r/:code', () => {
  it('serves the replay page for a match join code', async () => {
    const { app, service } = buildApp();
    const code = await finishedMatch(service);
    const res = await request(app).get(`/r/${code}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('og:title" content="Ana beat Ben 2–0 in RPSLR"');
    expect(res.text).toContain('<script src="/assets/x.js"></script>');
  });

  // The short URL is the one printed on the story card, so it is the one people
  // paste. It must preview as itself, not redirect the card onto the long form.
  it('names itself as the canonical URL rather than the long one', async () => {
    const { app, service } = buildApp();
    const code = await finishedMatch(service);
    const res = await request(app).get(`/r/${code}`);
    expect(res.text).toContain(`og:url" content="https://rpsls-duel.win/r/${code}"`);
    expect(res.text).not.toContain(`og:url" content="https://rpsls-duel.win/replay/${code}"`);
  });

  it('carries ?by= through, as the long route does', async () => {
    const { app, service } = buildApp();
    const code = await finishedMatch(service);
    const res = await request(app).get(`/r/${code}?by=1`);
    expect(res.text).toContain('og:title" content="Ana wins 2–0!"');
    expect(res.text).toContain(`og:url" content="https://rpsls-duel.win/r/${code}?by=1"`);
  });

  it('answers with the generic card for a code that means nothing', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/r/RPS-ZZZZ');
    expect(res.status).toBe(200);
    expect(res.text).toContain('og:title" content="RPSLR on JoinQuest"');
  });
});
