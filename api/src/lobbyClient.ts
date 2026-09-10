import { parseLobbyPlayerProfile, type LobbyPlayerProfile } from './lobbyProfile.js';
import type { AssignmentClaims } from './tokens.js';

const PLAYER_QUERY = `
  query Player($id: ID!) {
    player(id: $id) {
      id
      displayName
      avatarUrl
      preferredColor
    }
  }
`;

/**
 * One player is done with the match *for themselves* — quit, forfeited, or ran
 * out a grace period the game defined. Never a dropped socket: reporting a
 * player finished releases their queue row and closes their way back in, and a
 * player who lost wifi is still seated and still expected back.
 *
 * @see docs/lobby-protocol-handoff.md#reconnecting-a-player
 */
const REPORT_PLAYER_FINISHED = `
  mutation ReportPlayerFinished($matchId: ID!, $lobbyUserId: ID!, $reason: PlayerFinishReason!, $placement: Int) {
    reportPlayerFinished(matchId: $matchId, lobbyUserId: $lobbyUserId, reason: $reason, placement: $placement)
  }
`;

const REPORT_MATCH_RESULT = `
  mutation ReportMatchResult($matchId: ID!, $status: MatchResultStatus!, $winnerLobbyUserIds: [ID!]) {
    reportMatchResult(matchId: $matchId, status: $status, winnerLobbyUserIds: $winnerLobbyUserIds)
  }
`;

function authHeader(serviceToken: string): Record<string, string> {
  const token = serviceToken.trim();
  if (!token) return {};
  return {
    authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}`,
  };
}

/**
 * Resolve a Lobby user via GraphQL `player(id)` at the URL and token from provision.
 */
export async function fetchLobbyPlayerProfile(
  graphqlUrl: string,
  lobbyUserId: string,
  serviceToken: string,
): Promise<LobbyPlayerProfile | null> {
  const base = graphqlUrl.replace(/\/$/, '');
  let res: Response;
  try {
    res = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader(serviceToken) },
      body: JSON.stringify({ query: PLAYER_QUERY, variables: { id: lobbyUserId } }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  let body: { data?: { player?: unknown }; errors?: unknown[] };
  try {
    body = (await res.json()) as { data?: { player?: unknown }; errors?: unknown[] };
  } catch {
    return null;
  }
  if (body.errors?.length) return null;
  return parseLobbyPlayerProfile(body.data?.player) ?? null;
}

/** Name for a Lobby-linked claim: JWT `name` → Lobby GraphQL → body → fallback. */
export async function resolveClaimDisplayName(
  claims: AssignmentClaims,
  graphqlUrl: string | null,
  serviceToken: string | null,
  bodyPlayerName?: string,
): Promise<string> {
  if (claims.displayName?.trim()) return claims.displayName.trim();

  if (graphqlUrl && serviceToken) {
    const profile = await fetchLobbyPlayerProfile(graphqlUrl, claims.lobbyUserId, serviceToken);
    const name = profile?.displayName?.trim();
    if (name) return name;
  }

  const fromBody = bodyPlayerName?.trim();
  if (fromBody) return fromBody;

  return 'Player';
}

/**
 * How a player's participation ended. Lobby treats `DISCONNECT` specially when a
 * match is rated — it drops that player out of the rating inputs entirely — so
 * the reason is not decoration.
 */
export type PlayerFinishReason = 'COMPLETED' | 'ELIMINATED' | 'FORFEIT' | 'DISCONNECT';

/**
 * Tell Lobby one player is finished. Best-effort, like every other callback:
 * a match that cannot reach Lobby still plays.
 *
 * Call this when a player has genuinely **left** — not when their socket
 * dropped. See `REPORT_PLAYER_FINISHED` above.
 */
export async function reportPlayerFinished(
  graphqlUrl: string,
  serviceToken: string,
  matchId: string,
  lobbyUserId: string,
  reason: PlayerFinishReason,
  placement?: number,
): Promise<boolean> {
  const base = graphqlUrl.replace(/\/$/, '');
  let res: Response;
  try {
    res = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader(serviceToken) },
      body: JSON.stringify({
        query: REPORT_PLAYER_FINISHED,
        variables: { matchId, lobbyUserId, reason, placement: placement ?? null },
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.warn('[lobby] reportPlayerFinished request failed:', { matchId, lobbyUserId, err });
    return false;
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.warn('[lobby] reportPlayerFinished HTTP error:', {
      matchId,
      lobbyUserId,
      status: res.status,
      detail: detail.slice(0, 500),
    });
    return false;
  }
  let body: { data?: { reportPlayerFinished?: boolean }; errors?: unknown[] };
  try {
    body = (await res.json()) as typeof body;
  } catch (err) {
    console.warn('[lobby] reportPlayerFinished invalid JSON:', { matchId, lobbyUserId, err });
    return false;
  }
  if (body.errors?.length) {
    console.warn('[lobby] reportPlayerFinished GraphQL errors:', {
      matchId,
      lobbyUserId,
      errors: body.errors,
    });
    return false;
  }
  return body.data?.reportPlayerFinished === true;
}

/** Notify Lobby that the match is over (clears matched queue rows). Best-effort. */
export async function reportMatchResult(
  graphqlUrl: string,
  serviceToken: string,
  matchId: string,
  status: 'COMPLETED' | 'CANCELLED' | 'ABANDONED',
  winnerLobbyUserIds: string[] = [],
): Promise<boolean> {
  const base = graphqlUrl.replace(/\/$/, '');
  let res: Response;
  try {
    res = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader(serviceToken) },
      body: JSON.stringify({
        query: REPORT_MATCH_RESULT,
        variables: { matchId, status, winnerLobbyUserIds },
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.warn('[lobby] reportMatchResult request failed:', { matchId, err });
    return false;
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.warn('[lobby] reportMatchResult HTTP error:', {
      matchId,
      status: res.status,
      detail: detail.slice(0, 500),
    });
    return false;
  }
  let body: { data?: { reportMatchResult?: boolean }; errors?: unknown[] };
  try {
    body = (await res.json()) as typeof body;
  } catch (err) {
    console.warn('[lobby] reportMatchResult invalid JSON:', { matchId, err });
    return false;
  }
  if (body.errors?.length) {
    console.warn('[lobby] reportMatchResult GraphQL errors:', { matchId, errors: body.errors });
    return false;
  }
  if (body.data?.reportMatchResult !== true) {
    console.warn('[lobby] reportMatchResult returned false:', { matchId });
    return false;
  }
  return true;
}
