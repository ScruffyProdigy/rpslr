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
    body = await res.json();
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
