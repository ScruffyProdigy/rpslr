/**
 * The client's own index.html, so a replay link opens the real SPA rather than
 * a shell that only crawlers were meant to see.
 *
 * It is cached, but never blindly: index.html is the only file that names which
 * hashed bundle to load, and those are immutable for a year. Holding a stale
 * copy is how a deploy becomes invisible to the browsers it was for, so the
 * cached copy is revalidated with If-None-Match rather than simply reused.
 */
const SHELL_TTL_MS = 60_000;
const SHELL_TIMEOUT_MS = 500;

export const FALLBACK_SHELL = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RPSLR on JoinQuest</title></head>
  <body><p>Loading the replay…</p></body>
</html>`;

export interface ShellOptions {
  fetchImpl?: typeof fetch;
  ttlMs?: number;
  timeoutMs?: number;
}

let cached: { html: string; etag: string | null; fetchedAt: number } | null = null;

export function resetShellCache(): void {
  cached = null;
}

export async function getClientShell(origin: string, opts: ShellOptions = {}): Promise<string> {
  const { fetchImpl = fetch, ttlMs = SHELL_TTL_MS, timeoutMs = SHELL_TIMEOUT_MS } = opts;
  if (cached && Date.now() - cached.fetchedAt < ttlMs) return cached.html;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {};
    if (cached?.etag) headers['if-none-match'] = cached.etag;
    const res = await fetchImpl(`${origin.replace(/\/$/, '')}/index.html`, {
      signal: controller.signal,
      headers,
    });

    if (res.status === 304 && cached) {
      cached = { ...cached, fetchedAt: Date.now() };
      return cached.html;
    }
    if (!res.ok) return cached?.html ?? FALLBACK_SHELL;

    const html = await res.text();
    cached = { html, etag: res.headers.get('etag'), fetchedAt: Date.now() };
    return html;
  } catch {
    return cached?.html ?? FALLBACK_SHELL;
  } finally {
    clearTimeout(timer);
  }
}
