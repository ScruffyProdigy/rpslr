import type { Move } from './game.js';
import type { LobbyPlayerProfile } from './lobbyProfile.js';
import type { Phase } from './roundPolicy.js';

export type MatchStatus = 'waiting' | 'playing' | 'finished';

/**
 * How a match ended. `played` is someone reaching the winning score; the rest
 * come from the idle policy, where `abandoned` means both players went silent.
 */
export type MatchEndReason = 'played' | 'forfeit-strikes' | 'forfeit-disconnect' | 'abandoned';

export interface Match {
  id: string;
  code: string;
  externalMatchId: string | null;
  /** Lobby issuer URL from provision `lobbyId` (matches JWT `iss`). */
  lobbyId: string | null;
  /** Player-facing Lobby URL from provision `lobby.returnUrl`. */
  lobbyReturnUrl: string | null;
  /** Lobby GraphQL endpoint from provision `lobby.graphqlUrl`. */
  lobbyGraphqlUrl: string | null;
  /** Lobby service token from provision `lobby.serviceToken`. */
  lobbyServiceToken: string | null;
  /** Per Lobby user id, from provision and/or claim-time public GraphQL. */
  lobbyPlayerProfiles: Record<string, LobbyPlayerProfile>;
  name: string;
  gameMode: string;
  status: MatchStatus;
  bestOf: number;
  currentRound: number;
  /** Timed segment currently running, or null when nothing is on the clock. */
  phase: Phase | null;
  /**
   * ISO time `phase` began. Sent alongside the deadline so the client can draw
   * elapsed-vs-total without inferring the allowance from whichever snapshot it
   * happened to receive.
   */
  phaseStartedAt: string | null;
  /** ISO deadline for `phase`. The client renders it; the server owns it. */
  phaseDeadline: string | null;
  /** Set once the match is over. */
  endReason: MatchEndReason | null;
  /** Winner at the moment the match ended — a forfeit wins without scoring. */
  winnerSeatKey: string | null;
  createdAt: string;
}

/** A slot in a match. May be reserved for a Lobby user and/or already claimed. */
export interface Seat {
  id: string;
  matchId: string;
  seatKey: string;
  teamKey: string | null;
  role: string | null;
  position: number;
  reservedForLobbyUser: string | null;
  /** Lobby presentation for the reserved/claimed user (from provision or GraphQL). */
  lobbyProfile: LobbyPlayerProfile | null;
  /** Populated when a player has claimed this seat. */
  player: SeatPlayer | null;
  /** Current delay marks per move for this seat's player (cooldown system). */
  delays: Record<string, number>;
}

export interface SeatPlayer {
  id: string;
  name: string;
  lobbyUserId: string | null;
  score: number;
  profile: LobbyPlayerProfile | null;
  /** Consecutive rounds this player let expire; reset by any on-time move. */
  expiryStrikes: number;
}

export interface RoundResult {
  round: number;
  /** Winning seat_key, or 'draw'. */
  outcome: string;
  moves: Record<string, Move>;
  /** Player ids whose move the server chose for them when the round expired. */
  autoPicked: string[];
}

export interface MatchState {
  match: Match;
  seats: Seat[];
  results: RoundResult[];
  /** Player ids who have locked in this round (opponent's move stays hidden). */
  submittedPlayerIds: string[];
  /** This player's move for the in-progress round (only their own id appears). */
  currentRoundMoves: Record<string, Move>;
  /** Winning seat_key once decided, or 'draw'/null. */
  matchWinnerSeatKey: string | null;
  /**
   * The server's clock when this snapshot was built, ISO. The client renders
   * `match.phaseDeadline` as an offset from this rather than trusting its own
   * clock, which may be minutes off.
   */
  serverNow: string;
}

/** Input describing a seat to reserve when creating a match. */
export interface SeatReservation {
  seatKey: string;
  teamKey?: string | null;
  role?: string | null;
  position: number;
  reservedForLobbyUser?: string | null;
}
