import type { AbilityMap } from './helpers/abilities.js';
import type { Move } from './game.js';
import type { Loadout } from './helpers/loadout.js';
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
  /**
   * The two helpers this seat brought, settled at provision. Null in `duel`, which
   * is the null loadout rather than a special case.
   */
  loadout: Loadout | null;
  /**
   * Where a same-move collision displaced the cheaper helper's marks, rolled once
   * server-side when the match was created. Stored rather than re-thrown, because a
   * replay has to reach the marks the match reached the first time.
   */
  loadoutRoll: Move | null;
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

/**
 * Oracle's reveal, for the one seat that paid for it.
 *
 * Only ever populated for the holder, and only while the sub-phase is running.
 * `namedMove` is a move the opponent did **not** play — never the one they did,
 * which is what keeps commit-then-reveal intact. Null when the opponent played
 * their only live move: there was nothing they did not play to name.
 */
export interface OracleReveal {
  /** The round this reveal belongs to, so a stale one cannot be rendered. */
  round: number;
  /** A live move the opponent did not play, or null when there was none. */
  namedMove: Move | null;
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
   * Abilities spent in rounds that have already resolved. An in-progress round's
   * firing is deliberately absent — see `AbilityFiring.target`.
   */
  abilityFirings: AbilityFiring[];
  /**
   * Where the *viewing* seat's own charges stand, per held ability.
   *
   * Seat-private, and the reason a snapshot is projected per viewer rather than
   * broadcast as-is: a charge the viewer has already spent this round reads as
   * unavailable here, and that is exactly the tell an opponent must not get — it
   * says an unresolved firing happened. Empty for a viewer the server cannot
   * identify, and for any seat holding no abilities.
   */
  abilities: AbilityMap;
  /**
   * Oracle's mid-round reveal while `match.phase` is `oracle`, or null.
   *
   * Seat-private for the same reason `abilities` is, and more sharply: the set of
   * moves the server is willing to name is the complement of the move the
   * opponent played. An opponent who could read this would learn nothing, but a
   * holder who could provoke a *second* draw would learn everything — which is
   * why the named move is written down once rather than re-rolled per read.
   */
  oracle: OracleReveal | null;
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
  /** Settled before the seat exists, so it is never a match without one. */
  loadout?: Loadout | null;
  loadoutRoll?: Move | null;
}

/**
 * One ability a seat spent in one round.
 *
 * Everything else about a match replays from the move list. Firing does not: it is a
 * choice, so a charge spent is only knowable if it was written down. Without this
 * record a restart hands a player their abilities back.
 */
export interface AbilityFiring {
  round: number;
  seatKey: string;
  helperId: string;
  /**
   * The move the ability named, for the ones that name a move. Quarantine's is
   * withheld until the round resolves — naming it is a hedge against what the
   * opponent is about to play, and an opponent who could read it would simply play
   * something else.
   */
  target: Move | null;
  /**
   * The firing seat's *own* move, for Thief alone — it moves a mark rather than
   * adding one, so it names where the mark comes from as well as where it goes.
   * Null for every other ability.
   */
  source: Move | null;
}
