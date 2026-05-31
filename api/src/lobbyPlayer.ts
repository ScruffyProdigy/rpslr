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

function profileNeedsGraphqlFallback(
  profile: LobbyPlayerProfile | undefined,
  claims: AssignmentClaims,
): boolean {
  if (claims.displayName?.trim()) return !profile?.avatarUrl && !profile?.color;
  return !profileDisplayName(profile);
}

/**
 * Resolve profile for a Lobby claim: provision → JWT name overlay → Lobby GraphQL.
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

  if (
    opts.graphqlUrl &&
    opts.serviceToken &&
    profileNeedsGraphqlFallback(profile, opts.claims)
  ) {
    const fetched = await fetchLobbyPlayerProfile(
      opts.graphqlUrl,
      opts.claims.lobbyUserId,
      opts.serviceToken,
    );
    profile = mergeLobbyPlayerProfiles(profile, fetched ?? undefined);
  }

  return profile;
}

export function claimSeatName(
  profile: LobbyPlayerProfile | undefined,
  bodyPlayerName?: string,
): string {
  return profileDisplayName(profile) ?? bodyPlayerName?.trim() ?? 'Player';
}
