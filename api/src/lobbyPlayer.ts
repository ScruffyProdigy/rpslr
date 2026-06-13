import { fetchLobbyPlayerProfile } from './lobbyClient.js';
import {
  mergeLobbyPlayerProfiles,
  profileDisplayName,
  type LobbyPlayerProfile,
} from './lobbyProfile.js';
import type { AssignmentClaims } from './tokens.js';

export type { LobbyPlayerProfile } from './lobbyProfile.js';
export {
  lobbyProfilesFromSeats,
  mergeLobbyPlayerProfiles,
  parseLobbyPlayerProfile,
  profileDisplayName,
} from './lobbyProfile.js';

/**
 * Resolve profile for a Lobby claim: stored provision data → JWT name overlay → Lobby GraphQL `player(id)`.
 */
export async function resolveLobbyPlayerProfile(opts: {
  stored?: LobbyPlayerProfile;
  graphqlUrl: string | null;
  serviceToken: string | null;
  claims: AssignmentClaims;
}): Promise<LobbyPlayerProfile | undefined> {
  let profile = opts.stored ? { ...opts.stored } : undefined;

  if (opts.claims.displayName?.trim()) {
    profile = mergeLobbyPlayerProfiles(profile, { displayName: opts.claims.displayName.trim() });
  }

  if (opts.graphqlUrl && opts.serviceToken) {
    const fetched = await fetchLobbyPlayerProfile(
      opts.graphqlUrl,
      opts.claims.lobbyUserId,
      opts.serviceToken,
    );
    profile = mergeLobbyPlayerProfiles(profile, fetched ?? undefined);
  }

  return profile;
}

/** Hydrate lobbyUserId → profile from Lobby GraphQL for every player in the match. */
export async function fetchLobbyProfilesForUserIds(
  graphqlUrl: string,
  serviceToken: string,
  lobbyUserIds: string[],
): Promise<Record<string, LobbyPlayerProfile>> {
  const unique = [...new Set(lobbyUserIds.filter(Boolean))];
  const entries = await Promise.all(
    unique.map(async (lobbyUserId) => {
      const profile = await fetchLobbyPlayerProfile(graphqlUrl, lobbyUserId, serviceToken);
      return profile ? ([lobbyUserId, profile] as const) : null;
    }),
  );
  return Object.fromEntries(entries.filter((entry): entry is [string, LobbyPlayerProfile] => entry != null));
}

export function claimSeatName(
  profile: LobbyPlayerProfile | undefined,
  bodyPlayerName?: string,
): string {
  return profileDisplayName(profile) ?? bodyPlayerName?.trim() ?? 'Player';
}
