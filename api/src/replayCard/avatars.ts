/**
 * Lobby avatars, inlined into the card.
 *
 * Every failure here is ordinary — a starter icon that never resolved, a slow
 * host, a link that rotted — and none of them may cost us the card. The disc
 * falls back to the player's initial, exactly as PlayerAvatar does on the board.
 */
import type { CardModel } from './cardModel.js';

export const AVATAR_TIMEOUT_MS = 400;
export const AVATAR_MAX_BYTES = 200_000;

export interface AvatarOptions {
  timeoutMs?: number;
  maxBytes?: number;
  fetchImpl?: typeof fetch;
}

export async function fetchAvatarDataUri(
  url: string | null,
  opts: AvatarOptions = {},
): Promise<string | null> {
  if (!url || !isHttpUrl(url)) return null;
  const { timeoutMs = AVATAR_TIMEOUT_MS, maxBytes = AVATAR_MAX_BYTES, fetchImpl = fetch } = opts;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, redirect: 'follow' });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength > maxBytes) return null;
    return `data:${type.split(';')[0]};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The Lobby serves avatars over http(s); anything else is a local path we will not read. */
function isHttpUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export async function withAvatars(model: CardModel, opts: AvatarOptions = {}): Promise<CardModel> {
  const players = await Promise.all(
    model.players.map(async (player) => ({
      ...player,
      avatarDataUri: await fetchAvatarDataUri(player.avatarUrl, opts),
    })),
  );
  return { ...model, players };
}
