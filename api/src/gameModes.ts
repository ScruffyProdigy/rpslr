/**
 * Game-mode manifest for GET /api/v1/game-modes.
 * Field names match the JoinQuest Lobby catalog fetcher (`gameclient.Manifest`).
 * Match length (`bestOf`) is not part of the catalog — Lobby passes it on provision
 * when needed, or the game applies its own default.
 *
 * @see lobby/docs/game-catalog-architecture.md
 */

/** One playable mode in the catalog (layout + player counts only). */
export interface GameModeManifest {
  key: string;
  displayName: string;
  minPlayers: number;
  maxPlayers: number;
  seatTemplate: { count: number };
}

export const GAME_MODES: GameModeManifest[] = [
  {
    key: 'duel',
    displayName: '1v1 Duel',
    minPlayers: 2,
    maxPlayers: 2,
    seatTemplate: { count: 2 },
  },
];

/** Expanded seat keys for a mode (must stay aligned with Lobby seattemplate expand). */
export function seatKeysForMode(mode: GameModeManifest): string[] {
  const n = mode.seatTemplate?.count ?? 0;
  if (n < 1) {
    return [];
  }
  return Array.from({ length: n }, (_, i) => String(i + 1));
}

/** Default round length when provision/standalone omit `bestOf`. */
const BEST_OF_BY_MODE: Record<string, number> = {
  duel: 5,
};

export function getGameMode(key: string): GameModeManifest | undefined {
  return GAME_MODES.find((m) => m.key === key);
}

export function defaultBestOfForMode(modeKey: string): number {
  return BEST_OF_BY_MODE[modeKey] ?? 3;
}

export const DEFAULT_GAME_MODE = 'duel';

/** Response body for GET /api/v1/game-modes. */
export function buildGameModesPayload(game: string): { game: string; modes: GameModeManifest[] } {
  return { game, modes: GAME_MODES };
}
