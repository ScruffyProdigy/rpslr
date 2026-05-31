/**
 * Lobby-supplied player presentation data. Known fields are typed; additional
 * keys from provision or GraphQL are preserved for forward compatibility.
 */
export type LobbyPlayerProfile = {
  displayName?: string;
  avatarUrl?: string;
  color?: string;
  [key: string]: unknown;
};

export function parseLobbyPlayerProfile(raw: unknown): LobbyPlayerProfile | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const profile: LobbyPlayerProfile = {};
  for (const [key, value] of Object.entries(o)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) profile[key] = trimmed;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      profile[key] = value;
    }
  }
  if (Object.keys(profile).length === 0) return undefined;
  if (typeof profile.preferredColor === 'string' && !profile.color) {
    profile.color = profile.preferredColor;
    delete profile.preferredColor;
  }
  return profile;
}

export function profileDisplayName(profile: LobbyPlayerProfile | null | undefined): string | null {
  const name = profile?.displayName;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

export function mergeLobbyPlayerProfiles(
  base: LobbyPlayerProfile | undefined,
  overlay: LobbyPlayerProfile | undefined,
): LobbyPlayerProfile | undefined {
  if (!base && !overlay) return undefined;
  return { ...base, ...overlay };
}

/** Build lobbyUserId → profile map from provision seats. */
export function lobbyProfilesFromSeats(
  seats: Array<{ lobbyUserId: string; player?: LobbyPlayerProfile }>,
): Record<string, LobbyPlayerProfile> {
  const out: Record<string, LobbyPlayerProfile> = {};
  for (const s of seats) {
    if (s.player) out[s.lobbyUserId] = s.player;
  }
  return out;
}
