import { parseLobbyPlayerProfile } from './lobbyProfile.js';
import type { AssignmentSeat, SeatOptionSelection } from './tokens.js';

/** Lobby deployment endpoints supplied at provision time (not hardcoded on the game). */
export interface LobbyEndpoints {
  returnUrl: string;
  graphqlUrl: string;
  /** Per-match Bearer from Lobby provision (`v1.{gameId}.{sig}` or legacy global token); omit in dev. */
  serviceToken?: string;
}

/** Lobby → game push body for POST /api/v1/matches (option 2). */
export interface LobbyProvisionInput {
  lobbyId: string;
  lobby: LobbyEndpoints;
  assignment: {
    externalMatchId: string;
    gameMode: string;
    bestOf?: number;
    seats: AssignmentSeat[];
  };
}

/**
 * Shape-check a seat's pre-queue picks. Whether the ids are *legal* is a separate
 * question, answered against the mode's manifest in `preQueue.ts` — this only
 * establishes that a well-formed array arrived.
 *
 * `labels` is read and dropped on purpose. It is Lobby's cache of the strings this
 * game served at pick time, kept so a waiting player still reads "Ferrus" when the
 * game is unreachable. It is not authoritative and must never be read back as
 * identity, and the surest way to keep that true is for it not to exist past here.
 */
function parseSeatOptions(raw: unknown): SeatOptionSelection[] | undefined | string {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) return 'seat options must be an array of selection groups';

  const out: SeatOptionSelection[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') return 'each seat option entry must be an object';
    const o = row as Record<string, unknown>;
    const groupKey = typeof o.groupKey === 'string' ? o.groupKey.trim() : '';
    if (!groupKey) return 'each seat option entry requires groupKey';
    if (!Array.isArray(o.optionIds)) return `seat option ${groupKey} requires optionIds`;
    const optionIds: string[] = [];
    for (const value of o.optionIds) {
      if (typeof value !== 'string' || !value.trim()) {
        return `seat option ${groupKey} has a non-string optionId`;
      }
      optionIds.push(value.trim());
    }
    out.push({ groupKey, optionIds });
  }
  return out;
}

function parseLobbyEndpoints(raw: unknown): LobbyEndpoints | string {
  if (!raw || typeof raw !== 'object') return 'lobby is required';
  const o = raw as Record<string, unknown>;
  const returnUrl = typeof o.returnUrl === 'string' ? o.returnUrl.trim() : '';
  const graphqlUrl = typeof o.graphqlUrl === 'string' ? o.graphqlUrl.trim() : '';
  const serviceToken =
    typeof o.serviceToken === 'string' && o.serviceToken.trim()
      ? o.serviceToken.trim()
      : undefined;
  if (!returnUrl) return 'lobby.returnUrl is required';
  if (!graphqlUrl) return 'lobby.graphqlUrl is required';
  return { returnUrl, graphqlUrl, serviceToken };
}

export function parseLobbyProvision(body: unknown): LobbyProvisionInput | string {
  if (!body || typeof body !== 'object') return 'request body is required';
  const raw = body as Record<string, unknown>;

  const lobbyId = typeof raw.lobbyId === 'string' ? raw.lobbyId.trim() : '';
  if (!lobbyId) return 'lobbyId is required';

  const lobby = parseLobbyEndpoints(raw.lobby);
  if (typeof lobby === 'string') return lobby;

  const assignment = raw.assignment;
  if (!assignment || typeof assignment !== 'object') return 'assignment is required';

  const a = assignment as Record<string, unknown>;
  const externalMatchId =
    typeof a.externalMatchId === 'string' ? a.externalMatchId.trim() : '';
  const gameMode = typeof a.gameMode === 'string' ? a.gameMode.trim() : '';
  if (!externalMatchId) return 'assignment.externalMatchId is required';
  if (!gameMode) return 'assignment.gameMode is required';

  if (!Array.isArray(a.seats) || a.seats.length === 0) {
    return 'assignment.seats must be a non-empty array';
  }

  const seats: AssignmentSeat[] = [];
  for (const row of a.seats) {
    if (!row || typeof row !== 'object') return 'each assignment.seats entry must be an object';
    const s = row as Record<string, unknown>;
    const seatKey = typeof s.seatKey === 'string' ? s.seatKey.trim() : '';
    const lobbyUserId = typeof s.lobbyUserId === 'string' ? s.lobbyUserId.trim() : '';
    if (!seatKey) return 'each seat requires seatKey';
    if (!lobbyUserId) return 'each seat requires lobbyUserId';
    const player = parseLobbyPlayerProfile(s.player);
    const options = parseSeatOptions(s.options);
    if (typeof options === 'string') return options;
    seats.push({
      seatKey,
      lobbyUserId,
      team: typeof s.team === 'string' ? s.team : undefined,
      role: typeof s.role === 'string' ? s.role : undefined,
      player,
      options,
    });
  }

  let bestOf: number | undefined;
  if (a.bestOf !== undefined && a.bestOf !== null) {
    const n = Number(a.bestOf);
    if (!Number.isFinite(n)) return 'assignment.bestOf must be a number';
    bestOf = n;
  }

  return { lobbyId, lobby, assignment: { externalMatchId, gameMode, bestOf, seats } };
}

/**
 * When provision includes lobby.serviceToken, require Authorization: Bearer with the same value.
 * No auth required when the token is omitted (typical local dev).
 */
export function verifyLobbyProvisionAuth(
  authorization: string | undefined,
  serviceToken: string | undefined,
): string | null {
  const expected = serviceToken?.trim();
  if (!expected) return null;
  const match = (authorization ?? '').match(/^Bearer\s+(.+)$/i);
  const got = match?.[1]?.trim() ?? '';
  if (!got || got !== expected) {
    return 'provision requires Authorization: Bearer matching lobby.serviceToken';
  }
  return null;
}
