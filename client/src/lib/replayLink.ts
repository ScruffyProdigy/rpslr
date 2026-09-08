/**
 * Links out of a match: the replay of the match just played, and the way back
 * to JoinQuest from a replay someone was sent.
 */

/**
 * The reference a replay link is built on. A Lobby-provisioned match has a
 * stable public id; a standalone one only has its room code. `GET
 * /api/v1/matches/:ref` resolves either, so both make a working link.
 *
 * The room code doubles as the join code, which is harmless here: a replay
 * only ever renders a *finished* match, and a finished match cannot be joined.
 */
export function replayRef(match: { externalMatchId: string | null; code: string }): string | null {
  const external = match.externalMatchId?.trim();
  if (external) return external;
  const code = match.code?.trim();
  return code ? code : null;
}

/** Absolute, because the whole point is to paste it somewhere else. */
export function buildReplayUrl(
  ref: string,
  origin: string = typeof window !== 'undefined' ? window.location.origin : '',
): string {
  return `${origin.replace(/\/$/, '')}/replay/${encodeURIComponent(ref)}`;
}

/**
 * Tags a JoinQuest link as having come from a replay, so a sign-up can be
 * attributed to the match someone watched rather than lost in direct traffic.
 */
export function withReplayAttribution(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('ref', 'replay');
    return parsed.toString();
  } catch {
    // A relative link never parses as a URL, and still needs the marker.
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}ref=replay`;
  }
}
