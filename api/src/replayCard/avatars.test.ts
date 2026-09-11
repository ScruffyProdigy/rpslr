import { describe, expect, it, vi } from 'vitest';
import { fetchAvatarDataUri, withAvatars } from './avatars.js';
import type { CardModel } from './cardModel.js';

function pngResponse(bytes = 32, type = 'image/png') {
  return new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-type': type } });
}

const model: CardModel = {
  kind: 'match', ref: 'r', headline: 'h', ogTitle: 't', ogDescription: 'd', cacheable: true,
  players: [
    { seatKey: '1', name: 'Ana', score: 3, role: 'you', avatarUrl: 'https://lobby.test/ana.png', avatarDataUri: null, initial: 'A', winner: true },
    { seatKey: '2', name: 'Ben', score: 1, role: 'opp', avatarUrl: null, avatarDataUri: null, initial: 'B', winner: false },
  ],
  showdown: null, shortCode: null,
};

describe('fetchAvatarDataUri', () => {
  it('returns a data URI carrying the served content type', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(pngResponse(3, 'image/jpeg'));
    const uri = await fetchAvatarDataUri('https://lobby.test/a.jpg', { fetchImpl: fetchImpl as never });
    expect(uri?.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('returns null for no URL at all', async () => {
    expect(await fetchAvatarDataUri(null)).toBeNull();
  });

  it('refuses a response that is not an image', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    );
    expect(await fetchAvatarDataUri('https://lobby.test/a', { fetchImpl: fetchImpl as never })).toBeNull();
  });

  it('refuses a file over the byte cap', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(pngResponse(1024));
    expect(
      await fetchAvatarDataUri('https://lobby.test/a.png', { maxBytes: 512, fetchImpl: fetchImpl as never }),
    ).toBeNull();
  });

  it('gives up on a slow host rather than holding the card', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const started = Date.now();
    expect(
      await fetchAvatarDataUri('https://slow.test/a.png', { timeoutMs: 30, fetchImpl: fetchImpl as never }),
    ).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('returns null rather than throwing when the host is dead', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));
    expect(await fetchAvatarDataUri('https://dead.test/a.png', { fetchImpl: fetchImpl as never })).toBeNull();
  });

  it('refuses a URL that is not http — a data: or file: avatar is not ours to inline', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(pngResponse());
    expect(await fetchAvatarDataUri('file:///etc/passwd', { fetchImpl: fetchImpl as never })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('withAvatars', () => {
  it('fills in the players that have a URL and leaves the rest alone', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(pngResponse());
    const filled = await withAvatars(model, { fetchImpl: fetchImpl as never });
    expect(filled.players[0].avatarDataUri).toContain('base64,');
    expect(filled.players[1].avatarDataUri).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not mutate the model it was given', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(pngResponse());
    await withAvatars(model, { fetchImpl: fetchImpl as never });
    expect(model.players[0].avatarDataUri).toBeNull();
  });
});
