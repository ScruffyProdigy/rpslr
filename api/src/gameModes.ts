/**
 * Game-mode manifest for GET /api/v1/game-modes.
 * Field names match the JoinQuest Lobby catalog fetcher (`gameclient.Manifest`).
 * Match length (`bestOf`) is not part of the catalog — Lobby passes it on provision
 * when needed, or the game applies its own default.
 *
 * @see lobby/docs/game-catalog-architecture.md
 */

/**
 * One roster a mode asks a player to pick from before queueing.
 *
 * A group is an *independent* roster with its own arity, so a mode wanting a weapon
 * and an armour set declares two. RPSLR declares one, whose choices fall under three
 * `sectionOrder` headings — a section is a display heading inside a group, not a
 * group of its own. Both sides used "group" for the other meaning once; see
 * `docs/prequeue-options-contract.md` §Vocabulary.
 */
export interface PreQueueGroup {
  key: string;
  /** Names the roster this group is picked from. `queueOptions.ts` maps it to one. */
  kind: string;
  label: string;
  /** Arity lives here rather than on the block, or the two-group case is impossible. */
  min: number;
  max: number;
  /**
   * Section headings in the order the picker should show them. Meaningful — RPSLR's
   * reads as a price ladder — and neither alphabetical nor roster order produces it.
   */
  sectionOrder?: string[];
  locking: 'none';
}

/**
 * Declaring this **is** the capability signal: Lobby sends `options` on provision
 * only for a mode whose own manifest carries it, so the two sides self-synchronise
 * in either deploy order and no separate flag on `/api/v1/status` is needed.
 */
export interface PreQueue {
  groups: PreQueueGroup[];
}

/** One playable mode in the catalog (layout + player counts only). */
export interface GameModeManifest {
  key: string;
  displayName: string;
  minPlayers: number;
  maxPlayers: number;
  seatTemplate: { count: number };
  /** Omitted entirely by a mode with no pre-queue pick. */
  preQueue?: PreQueue;
}

export const GAME_MODES: GameModeManifest[] = [
  {
    key: 'duel',
    displayName: '1v1 Duel',
    minPlayers: 2,
    maxPlayers: 2,
    seatTemplate: { count: 2 },
  },
  {
    key: 'duel-helpers',
    displayName: 'Helpers',
    minPlayers: 2,
    maxPlayers: 2,
    seatTemplate: { count: 2 },
    preQueue: {
      groups: [
        {
          key: 'helpers',
          kind: 'Loadout',
          label: 'Choose your two helpers',
          min: 2,
          max: 2,
          sectionOrder: ['Major', 'Minor', 'Trinket'],
          locking: 'none',
        },
      ],
    },
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
  'duel-helpers': 5,
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
