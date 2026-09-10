import type { Move } from './game.js';
import type { LobbyPlayerProfile } from './lobbyProfile.js';
import type { Phase } from './roundPolicy.js';
import type {
  AbilityFiring,
  Match,
  MatchEndReason,
  MatchStatus,
  RoundResult,
  Seat,
  SeatPlayer,
  SeatReservation,
} from './types.js';

export interface CreateMatchInput {
  code: string;
  externalMatchId?: string | null;
  lobbyId?: string | null;
  lobbyReturnUrl?: string | null;
  lobbyGraphqlUrl?: string | null;
  lobbyServiceToken?: string | null;
  lobbyPlayerProfiles?: Record<string, LobbyPlayerProfile>;
  name: string;
  gameMode: string;
  bestOf: number;
  seats: SeatReservation[];
}

export interface ClaimSeatInput {
  matchId: string;
  seatKey: string;
  name: string;
  lobbyUserId?: string | null;
}

/**
 * Storage abstraction for the generalized match/seat model. A Postgres
 * implementation backs production and `dev.sh`; an in-memory implementation
 * backs unit tests and a standalone fallback.
 */
export interface GameRepository {
  createMatch(input: CreateMatchInput): Promise<Match>;
  getMatch(idOrCodeOrExternal: string): Promise<Match | null>;
  setLobbyPlayerProfiles(
    matchId: string,
    profiles: Record<string, LobbyPlayerProfile>,
  ): Promise<void>;
  listSeats(matchId: string): Promise<Seat[]>;
  /** Idempotent per (matchId, lobbyUserId): re-claiming returns the existing seat. */
  claimSeat(input: ClaimSeatInput): Promise<{ seat: Seat; player: SeatPlayer }>;
  setMatchStatus(matchId: string, status: MatchStatus): Promise<void>;
  setMatchProgress(matchId: string, currentRound: number, status: MatchStatus): Promise<void>;
  /** Put a phase on the clock, or clear it by passing nulls. */
  setPhase(
    matchId: string,
    phase: Phase | null,
    startedAtIso: string | null,
    deadlineIso: string | null,
  ): Promise<void>;
  /** Consecutive expiries for one player; 0 clears the run. */
  setExpiryStrikes(matchId: string, playerId: string, strikes: number): Promise<void>;
  /**
   * End a match without anyone reaching the winning score. `winnerSeatKey` is
   * null when both players went silent and nobody earned it.
   */
  endMatch(
    matchId: string,
    winnerSeatKey: string | null,
    endReason: MatchEndReason,
  ): Promise<void>;
  recordMove(input: {
    matchId: string;
    round: number;
    playerId: string;
    move: Move;
  }): Promise<void>;
  /**
   * Overwrite a move already recorded for this round. Oracle's sub-phase is the
   * only thing that may do this: the holder paid a charge for the right to
   * reconsider, and there is no other point in a round where a committed move
   * stops being final. Separate from `recordMove` so that the ordinary path
   * keeps its "a move already submitted is a conflict" guarantee rather than
   * gaining a silent overwrite nobody asked for.
   */
  replaceMove(input: {
    matchId: string;
    round: number;
    playerId: string;
    move: Move;
  }): Promise<void>;
  getMovesForRound(matchId: string, round: number): Promise<Record<string, Move>>;
  saveRoundResult(input: {
    matchId: string;
    result: RoundResult;
    scores: Record<string, number>;
  }): Promise<void>;
  listResults(matchId: string): Promise<RoundResult[]>;
  /**
   * Record an ability a seat spent this round. At most one per *slot* per round —
   * each ability sits on its own slot on the cooldown track, with its own opening
   * and its own recharge, so a loadout holding two charge cards has two to spend
   * (JQ-238). Re-recording the same ability in the same round is a conflict, not an
   * overwrite: a spent charge is not a decision anyone gets to take back.
   */
  recordAbilityFiring(input: {
    matchId: string;
    seatId: string;
    round: number;
    helperId: string;
    target: Move | null;
    /** Thief's own-side move; null for every other ability. */
    source: Move | null;
  }): Promise<void>;
  /**
   * Write the move Oracle named onto a firing that has none yet, and report
   * whether this call is the one that wrote it.
   *
   * Oracle is the one ability whose target the *server* chooses, and it cannot
   * choose it at fire time: the opponent has not moved yet. So the firing is
   * recorded with a null target and named later, when both moves are in.
   *
   * Conditional on the target still being null, because the draw must happen
   * exactly once. Two readers racing into the sub-phase would otherwise name two
   * different moves, and a holder who could provoke a re-roll would learn the
   * opponent's move by elimination — it is the one the server never names. The
   * loser of the race is told `false` and reads the winner's move back.
   */
  nameAbilityFiringTarget(input: {
    matchId: string;
    seatId: string;
    round: number;
    /**
     * Which of the seat's firings to name. A seat may hold two charged abilities
     * and fire both in one round (JQ-238), so (match, round, seat) no longer
     * identifies a row — without this the draw could land on the wrong firing.
     */
    helperId: string;
    target: Move | null;
  }): Promise<boolean>;
  /** Every firing in the match, in round order. Callers decide what to disclose. */
  listAbilityFirings(matchId: string): Promise<AbilityFiring[]>;
  close(): Promise<void>;
}

export class NotFoundError extends Error {}
export class ConflictError extends Error {}
/** Seat is reserved for a different Lobby user. */
export class ReservationError extends Error {}

/** Shared short join-code generator. */
export function makeCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `RPS-${s}`;
}
