import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FALLBACK_SHELL, getClientShell, resetShellCache } from './clientTemplate.js';

const HTML =
  '<!doctype html><html><head><title>RPSLR</title></head><body><script src="/assets/x.js"></script></body></html>';

function htmlResponse(body = HTML, etag = 'W/"abc"') {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html', etag } });
}

describe('getClientShell', () => {
  beforeEach(() => resetShellCache());

  it('fetches index.html from the client origin', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(htmlResponse());
    expect(await getClientShell('http://client', { fetchImpl: fetchImpl as never })).toBe(HTML);
    expect(fetchImpl.mock.calls[0][0]).toBe('http://client/index.html');
  });

  it('serves the cached copy inside the TTL without asking again', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(htmlResponse());
    await getClientShell('http://client', { fetchImpl: fetchImpl as never });
    await getClientShell('http://client', { fetchImpl: fetchImpl as never });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('revalidates with If-None-Match once the TTL lapses, and keeps the body on 304', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse())
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    await getClientShell('http://client', { fetchImpl: fetchImpl as never, ttlMs: 0 });
    expect(await getClientShell('http://client', { fetchImpl: fetchImpl as never, ttlMs: 0 })).toBe(HTML);
    expect((fetchImpl.mock.calls[1][1] as RequestInit).headers).toMatchObject({
      'if-none-match': 'W/"abc"',
    });
  });

  it('picks up a redeployed bundle rather than holding the old one', async () => {
    const next = HTML.replace('/assets/x.js', '/assets/y.js');
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse())
      .mockResolvedValueOnce(htmlResponse(next, 'W/"def"'));
    await getClientShell('http://client', { fetchImpl: fetchImpl as never, ttlMs: 0 });
    expect(await getClientShell('http://client', { fetchImpl: fetchImpl as never, ttlMs: 0 })).toContain(
      '/assets/y.js',
    );
  });

  it('falls back to a built-in shell when the client cannot be reached', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await getClientShell('http://client', { fetchImpl: fetchImpl as never })).toBe(FALLBACK_SHELL);
  });

  it('keeps serving the last good copy when a later fetch fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse())
      .mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await getClientShell('http://client', { fetchImpl: fetchImpl as never, ttlMs: 0 });
    expect(await getClientShell('http://client', { fetchImpl: fetchImpl as never, ttlMs: 0 })).toBe(HTML);
  });
});
