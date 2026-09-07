import { getEnv } from './env';

export type Move = 'rock' | 'paper' | 'scissors' | 'lizard' | 'robot';
export type MatchStatus = 'waiting' | 'playing' | 'finished';
/** A timed segment of a match. Only 'pick' exists today. */
export type Phase = 'pick';
/** How a match ended; everything but 'played' comes from the idle policy. */
export type MatchEndReason = 'played' | 'forfeit-strikes' | 'forfeit-disconnect' | 'abandoned';

export interface LobbyPlayerProfile {
  displayName?: string;
  avatarUrl?: string;
}

export interface SeatPlayer {
  id: string;
  name: string;
  lobbyUserId: string | null;
  score: number;
  profile: LobbyPlayerProfile | null;
  /** Consecutive rounds this player let expire; any on-time move clears it. */
  expiryStrikes: number;
}

export interface Seat {
  id: string;
  matchId: string;
  seatKey: string;
  teamKey: string | null;
  role: string | null;
  position: number;
  reservedForLobbyUser: string | null;
  player: SeatPlayer | null;
  lobbyProfile: LobbyPlayerProfile | null;
  delays: Record<string, number>;
}

export interface Match {
  id: string;
  code: string;
  externalMatchId: string | null;
  /** Lobby issuer URL from provision `lobbyId` (matches JWT `iss`). */
  lobbyId: string | null;
  /** Player-facing Lobby URL from provision `lobby.returnUrl`. */
  lobbyReturnUrl: string | null;
  lobbyGraphqlUrl: string | null;
  name: string;
  gameMode: string;
  status: MatchStatus;
  bestOf: number;
  currentRound: number;
  /** Timed segment currently running, or null when nothing is on the clock. */
  phase: Phase | null;
  /** ISO time `phase` began; with the deadline this gives the full allowance. */
  phaseStartedAt: string | null;
  /** ISO deadline for `phase`. Server-owned; the client only renders it. */
  phaseDeadline: string | null;
  endReason: MatchEndReason | null;
  winnerSeatKey: string | null;
  createdAt: string;
}

export interface RoundResult {
  round: number;
  outcome: string; // winning seatKey, or 'draw'
  moves: Record<string, Move>;
  /** Player ids whose move the server chose when the round ran out of time. */
  autoPicked: string[];
}

export interface MatchState {
  match: Match;
  seats: Seat[];
  results: RoundResult[];
  /** Player ids who have locked in for the current round. */
  submittedPlayerIds: string[];
  /** In-progress moves (your id only until the round resolves; opponent move hidden). */
  currentRoundMoves: Record<string, Move>;
  matchWinnerSeatKey: string | null;
  /**
   * The server's clock when this snapshot was built. The countdown is rendered
   * as an offset from this, never from the device clock, which may be far off.
   */
  serverNow: string;
}

export interface ClaimResult {
  state: MatchState;
  you: { playerId: string; seatKey: string; name: string };
}

export interface StatusResponse {
  game: string;
  version: string;
  appEnv: string;
  standalone: boolean;
}

function baseUrl(): string {
  return getEnv().GAME_API_BASE_URL.replace(/\/$/, '');
}

async function request<T>(path: string, init?: RequestInit, token?: string | null): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers['authorization'] = `Bearer ${token}`;
  const res = await fetch(`${baseUrl()}${path}`, { headers, ...init });
  if (!res.ok) {
    let message = `request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export const api = {
  status: () => request<StatusResponse>('/api/v1/status'),

  createMatch: (body: { name?: string; hostName?: string; bestOf?: number; lobbyUserId?: string }) =>
    request<ClaimResult>('/api/v1/matches', { method: 'POST', body: JSON.stringify(body) }),

  getState: (ref: string) => request<MatchState>(`/api/v1/matches/${ref}`),

  // Standalone: claim with a seatKey (or omit to auto-pick an open seat).
  claimSeat: (ref: string, body: { playerName?: string; seatKey?: string; lobbyUserId?: string }) =>
    request<ClaimResult>(`/api/v1/matches/${ref}/claim`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Lobby-linked: claim the seat dictated by a signed Lobby token.
  claimSeatWithToken: (ref: string, token: string) =>
    request<ClaimResult>(`/api/v1/matches/${ref}/claim`, { method: 'POST', body: '{}' }, token),

  submitMove: (ref: string, playerId: string, move: Move, round: number) =>
    request<MatchState>(`/api/v1/matches/${ref}/move`, {
      method: 'POST',
      // `round` keeps a move that arrives after its round resolved from being
      // recorded against the next one.
      body: JSON.stringify({ playerId, move, round }),
    }),
};
