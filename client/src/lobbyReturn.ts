/**
 * Player-facing return link after a Lobby-provisioned match.
 * Mirror of Lobby's returnlink.AppendMatchID — keep in sync with
 * docs/player-return-routing.md in the Lobby repo.
 */
export function buildLobbyReturnLink(returnUrl: string, externalMatchId: string | null): string {
  const base = returnUrl.trim();
  const matchId = externalMatchId?.trim() ?? '';
  if (!base) {
    return matchId ? `/return?match=${encodeURIComponent(matchId)}` : '/return';
  }
  if (!matchId) return base;

  try {
    const url = new URL(base);
    url.searchParams.set('match', matchId);
    return url.toString();
  } catch {
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}match=${encodeURIComponent(matchId)}`;
  }
}
