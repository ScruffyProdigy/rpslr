import type { AssignmentSeat } from './tokens.js';

export interface LaunchUrlAssignment {
  externalMatchId: string;
  seats: Pick<AssignmentSeat, 'seatKey' | 'lobbyUserId'>[];
}

/**
 * Build per-player launch URL bases for Lobby to attach seat JWTs.
 * Query-style: {playUrl}?match={externalMatchId}&seat={seatKey}
 */
export function buildLaunchUrlsForAssignment(
  playUrl: string,
  assignment: LaunchUrlAssignment,
): Record<string, string> {
  const origin = playUrl.trim().replace(/\/$/, '');
  const urls: Record<string, string> = {};
  for (const seat of assignment.seats) {
    const lobbyUserId = seat.lobbyUserId.trim();
    const seatKey = seat.seatKey.trim();
    if (!lobbyUserId || !seatKey) continue;
    const u = new URL(origin.includes('://') ? origin : `https://${origin}`);
    u.searchParams.set('match', assignment.externalMatchId);
    u.searchParams.set('seat', seatKey);
    urls[lobbyUserId] = u.toString();
  }
  return urls;
}
