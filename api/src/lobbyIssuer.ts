/** JWKS document URL for a Lobby deployment identified by its issuer / lobbyId. */
export function lobbyJwksUrl(lobbyIssuer: string): string {
  return `${normalizeLobbyIssuer(lobbyIssuer)}/.well-known/jwks.json`;
}

/** GraphQL endpoint for a Lobby deployment (same origin as issuer / lobbyId). */
export function lobbyGraphqlUrl(lobbyIssuer: string): string {
  return normalizeLobbyIssuer(lobbyIssuer);
}

/** Normalize lobby issuer / lobbyId URLs for comparison (matches Lobby's LobbyIssuer()). */
export function normalizeLobbyIssuer(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  try {
    const u = new URL(trimmed);
    u.search = '';
    u.hash = '';
    const path = u.pathname.replace(/\/$/, '') || '';
    return `${u.protocol}//${u.host}${path}`.replace(/\/$/, '');
  } catch {
    return trimmed.replace(/\/$/, '');
  }
}

export function lobbyIssuersMatch(a: string, b: string): boolean {
  return normalizeLobbyIssuer(a) === normalizeLobbyIssuer(b);
}
