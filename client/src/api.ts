import { getEnv } from './env';

export type Move = 'rock' | 'paper' | 'scissors' | 'lizard' | 'spock';
export type MatchStatus = 'waiting' | 'playing' | 'finished';

export interface SeatPlayer {
  id: string;
  name: string;
  lobbyUserId: string | null;
  score: number;
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
  createdAt: string;
}

export interface RoundResult {
  round: number;
  outcome: string; // winning seatKey, or 'draw'
  moves: Record<string, Move>;
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

  submitMove: (ref: string, playerId: string, move: Move) =>
    request<MatchState>(`/api/v1/matches/${ref}/move`, {
      method: 'POST',
      body: JSON.stringify({ playerId, move }),
    }),
};
