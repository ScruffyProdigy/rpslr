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
 * What one ability revealed to its own holder, mid-round.
 *
 * Only ever populated for that holder, and only while the sub-phase is running.
 * Oracle's `namedMove` is a move the opponent did **not** play — never the one
 * they did, which is what keeps commit-then-reveal intact. Null when there was
 * nothing to name: for Oracle, when the opponent played their only live move.
 */
export interface MidRoundReveal {
  /** The ability that paid for it. */
  helperId: string;
  /** The move it named, or null when there was none to name. */
  namedMove: Move | null;
}

/**
 * A public firing aimed at this seat in the round being played.
 *
 * Carries what the firing discloses and no more. Whether it *landed* is not here,
 * because that would turn on the opponent's committed move — and a seat told "it
 * missed" would be told, by elimination, something about their own board that the
 * firer has not paid for. Withholding also makes hit and miss indistinguishable,
 * which is what keeps the absence of a window from being information (see
 * `entitlement`).
 */
export interface IncomingFiring {
  helperId: string;
  /** The move the firing named, for the abilities that name one. */
  target: Move | null;
}

/**
 * Why one seat may act in the round's sub-phase, and what it was told.
 *
 * The class is *information that reaches a player after their commitment and
 * before the round resolves* — the one gap in a round with no window in it. Two
 * ways in: an ability revealed something to its own holder (Oracle), or a public
 * firing acted against them.
 *
 * Entitlement deliberately does not depend on a public firing having *hit*. If it
 * did, not getting a window would tell the firer that it missed — the absence of a
 * sub-phase would become information, in exactly the way a phase transition
 * already leaks lock-in timing past Poker Face.
 */
export interface Entitlement {
  /** The round this belongs to, so a stale one cannot be rendered. */
  round: number;
  /** What this seat's own abilities told it. Empty when it was only fired upon. */
  reveals: MidRoundReveal[];
  /** Public firings acting against this seat this round, whether or not they landed. */
  incoming: IncomingFiring[];
  /** Whether this seat has already used the window. */
  acted: boolean;
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
   * The firings every viewer may see: everything from a resolved round, plus the
   * in-progress round's `public` ones. A `secret` firing in the round being played
   * is deliberately absent — see `AbilityFiring.target` and `helpers/disclosure.ts`.
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
   * This seat's claim on the mid-round sub-phase while `match.phase` is `react`,
   * or null when it has none.
   *
   * Seat-private for the same reason `abilities` is, and more sharply where a
   * reveal is involved: the set of moves the server is willing to name is the
   * complement of the move the opponent played. An opponent who could read this
   * would learn nothing, but a holder who could provoke a *second* draw would
   * learn everything — which is why a named move is written down once rather than
   * re-rolled per read.
   */
  entitlement: Entitlement | null;
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
   * The move the ability named, for the ones that name a move. A `secret` firing's
   * is withheld until the round resolves — Quarantine's naming is a hedge against
   * what the opponent is about to play, and an opponent who could read it would
   * simply play something else. A `public` firing's is disclosed as it is fired,
   * which is what gives the seat it acts against something to answer.
   */
  target: Move | null;
  /**
   * The firing seat's *own* move, for Thief alone — it moves a mark rather than
   * adding one, so it names where the mark comes from as well as where it goes.
   * Null for every other ability.
   */
  source: Move | null;
}
