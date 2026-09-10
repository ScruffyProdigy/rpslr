import {
  DEFAULT_GAME_MODE,
  defaultBestOfForMode,
  getGameMode,
  seatKeysForMode,
  type GameModeManifest,
} from './gameModes.js';
import { lobbyIssuersMatch } from './lobbyIssuer.js';
import { reportMatchResult } from './lobbyClient.js';
import {
  claimSeatName,
  fetchLobbyProfilesForUserIds,
  resolveLobbyPlayerProfile,
} from './lobbyPlayer.js';
import type { LobbyProvisionInput } from './provision.js';
import { TokenError, type SeatOptionSelection } from './tokens.js';
import {
  availableMoves,
  computeDelays,
  isMove,
  matchWinner,
  resolveRound,
  winsNeeded,
  type DelayMap,
  type Firing,
  type Move,
  type PlayedRound,
  type PlayerRules,
} from './game.js';
import { chargesNow, slotsFor, type AbilityMap } from './helpers/abilities.js';
import { nameUnplayedMove } from './helpers/oracle.js';
import { viewSnapshotAs, type MatchSnapshot } from './matchView.js';
import { rollFor } from './helpers/rules.js';
import { uniformPicker } from './helpers/loadout.js';
import { disclosedFirings } from './helpers/disclosure.js';
import {
  boardsThroughMatch,
  firedIn,
  playedRoundsFrom,
  rulesForSeats,
  type ReconstructionSeat,
} from './replayBoard.js';
import {
  isPreQueueRejection,
  resolvePreQueueOptions,
  seatLoadout,
  type ResolvedSelection,
} from './preQueue.js';
import type { MatchHub } from './matchHub.js';
import type { PresenceTracker } from './presence.js';
import {
  chooseAutoPick,
  deadlineFor,
  decidePenalty,
  policyForMode,
  type Phase,
} from './roundPolicy.js';
import {
  ConflictError,
  NotFoundError,
  makeCode,
  type GameRepository,
} from './repository.js';
import type {
  AbilityFiring,
  Match,
  MatchEndReason,
  MatchState,
  OracleReveal,
  RoundResult,
  Seat,
  SeatReservation,
} from './types.js';
import type { AssignmentClaims, AssignmentSeat } from './tokens.js';

export class ValidationError extends Error {}

/**
 * A pre-queue selection the game will not seat.
 *
 * Separate from `ValidationError` because the contract's body carries the seat and
 * the reason as fields, and because the status matters: this is a `400`. A `403`
 * would be read by Lobby as the banlist handshake and re-matchmade forever.
 *
 * It fails the whole provision. `seatKey` is for diagnosis, not for salvaging the
 * other seats — there is no match left to salvage them into.
 */
export class PreQueueError extends Error {
  constructor(
    public readonly seatKey: string,
    public readonly reason: string,
  ) {
    super(`invalid pre-queue selection for seat ${seatKey}: ${reason}`);
  }
}

/** A pushed roster contained a player this game refuses to host. */
export class BannedPlayerError extends Error {
  constructor(public readonly bannedLobbyUserIds: string[]) {
    super(`roster contains banned player(s): ${bannedLobbyUserIds.join(', ')}`);
  }
}

export interface ClaimResult {
  state: MatchState;
  you: { playerId: string; seatKey: string; name: string };
}

export interface GameServiceOptions {
  /** Lobby user ids this game refuses to host; a push including them is rejected. */
  bannedLobbyUsers?: string[];
  /** Optional live-update bus; state is published after every mutation. */
  hub?: MatchHub;
  /** Who currently holds a socket; the disconnect grace period needs this. */
  presence?: PresenceTracker;
  /** Injectable clock, so deadline tests need not wait in real time. */
  now?: () => number;
  /** Injectable randomness for auto-picks, so tests are deterministic. */
  rng?: () => number;
}

/**
 * Game service: orchestrates the generalized match/seat lifecycle on top of a
 * repository. RPS resolution (2-seat "duel") lives here; the seating model
 * itself is game-agnostic.
 *
 * Every state-changing operation publishes the fresh state to the (optional)
 * MatchHub, so WebSocket subscribers update regardless of whether the change
 * arrived via REST or WS.
 */
export class GameService {
  private readonly banned: Set<string>;
  private readonly hub?: MatchHub;
  private readonly presence?: PresenceTracker;
  private readonly now: () => number;
  private readonly rng: () => number;
  /** One enforcement pass per match at a time; see `enforceDeadlines`. */
  private readonly enforcing = new Map<string, Promise<void>>();

  constructor(private readonly repo: GameRepository, options: GameServiceOptions = {}) {
    this.banned = new Set(options.bannedLobbyUsers ?? []);
    this.hub = options.hub;
    this.presence = options.presence;
    this.now = options.now ?? Date.now;
    this.rng = options.rng ?? Math.random;
  }

  // --- Match creation -------------------------------------------------------

  /** Standalone self-serve: create a match and seat the host in the first seat. */
  async createStandaloneMatch(opts: {
    gameMode?: string;
    name?: string;
    bestOf?: number;
    hostName?: string;
    hostLobbyUserId?: string | null;
    /**
     * Pre-queue picks per seat, for a mode that asks for them. Standalone has no
     * lobby to pick in, so it names the loadouts up front instead — there is no
     * default to fall back on, and inventing one here is exactly what v5 removed.
     */
    seats?: { seatKey: string; options?: SeatOptionSelection[] }[];
  }): Promise<ClaimResult> {
    const mode = this.requireMode(opts.gameMode ?? DEFAULT_GAME_MODE);
    const bestOf = clampBestOf(opts.bestOf, defaultBestOfForMode(mode.key));
    const reservations = seatsFromMode(mode);
    const named = new Map((opts.seats ?? []).map((s) => [s.seatKey, s.options]));
    const selections = this.resolveSelections(
      mode,
      reservations.map((r) => ({
        seatKey: r.seatKey,
        lobbyUserId: '',
        options: named.get(r.seatKey),
      })),
    );
    const match = await this.repo.createMatch({
      code: await this.uniqueCode(),
      name: opts.name?.trim() || 'Untitled Match',
      gameMode: mode.key,
      bestOf,
      seats: this.withLoadouts(mode, selections, reservations),
    });
    const seatKeys = seatKeysForMode(mode);
    const firstSeatKey = seatKeys[0];
    return this.claimSeat(match.code, {
      seatKey: firstSeatKey,
      name: opts.hostName?.trim() || 'Host',
      lobbyUserId: opts.hostLobbyUserId ?? null,
    });
  }

  /**
   * Validate the pre-queue selections for a set of seats, or refuse to seat them.
   *
   * There is nothing to fall back on: a mode declaring `preQueue` requires a
   * selection per seat, and a missing one is a rejection rather than a prompt to
   * invent a loadout the player did not choose.
   */
  private resolveSelections(
    mode: GameModeManifest,
    seats: AssignmentSeat[],
  ): ResolvedSelection[] {
    const resolved = resolvePreQueueOptions(mode, seats);
    if (isPreQueueRejection(resolved)) {
      throw new PreQueueError(resolved.seatKey, resolved.reason);
    }
    return resolved;
  }

  /**
   * Attach each seat's loadout, and settle its roll, before the seats exist.
   *
   * The roll is thrown once here rather than per request. Two helpers bound to the
   * same move displace the cheaper one's marks onto a move drawn at random, and a
   * throw repeated on every read would give a match a different opening every time
   * anyone looked at it.
   */
  private withLoadouts(
    mode: GameModeManifest,
    selections: ResolvedSelection[],
    reservations: SeatReservation[],
  ): SeatReservation[] {
    const pick = uniformPicker(this.rng);
    return reservations.map((reservation) => {
      const loadout = seatLoadout(mode, selections, reservation.seatKey);
      return { ...reservation, loadout, loadoutRoll: rollFor(loadout, pick) };
    });
  }

  /**
   * Lobby push (option 2 — the authoritative provisioning path): create a match
   * from an assignment, reserving each seat for the assigned Lobby user.
   * Idempotent on externalMatchId.
   *
   * This is the handshake where the game can REJECT a roster (e.g. a banned
   * player) so Lobby can correct before any player is sent over.
   */
  async ensureMatchFromAssignment(input: LobbyProvisionInput): Promise<MatchState> {
    const { lobbyId, assignment } = input;
    const existing = await this.repo.getMatch(assignment.externalMatchId);
    if (existing) return this.sharedState(existing.id);

    // Reject the whole roster if it contains any banned player.
    const banned = assignment.seats
      .map((s) => s.lobbyUserId)
      .filter((id) => this.banned.has(id));
    if (banned.length > 0) {
      throw new BannedPlayerError([...new Set(banned)]);
    }

    const mode = this.requireMode(assignment.gameMode);
    assertAssignmentCoversMode(mode, assignment.seats);
    const selections = this.resolveSelections(mode, assignment.seats);
    const reservations = this.withLoadouts(
      mode,
      selections,
      reservationsFromAssignment(mode, assignment.seats),
    );
    let match: Match;
    try {
      match = await this.repo.createMatch({
        code: await this.uniqueCode(),
        externalMatchId: assignment.externalMatchId,
        lobbyId,
        lobbyReturnUrl: input.lobby.returnUrl,
        lobbyGraphqlUrl: input.lobby.graphqlUrl,
        lobbyServiceToken: input.lobby.serviceToken ?? null,
        lobbyPlayerProfiles: Object.fromEntries(
          assignment.seats
            .filter((s) => s.player)
            .map((s) => [s.lobbyUserId, s.player!]),
        ),
        name: 'Duel',
        gameMode: mode.key,
        bestOf: clampBestOf(assignment.bestOf, defaultBestOfForMode(mode.key)),
        seats: reservations,
      });
    } catch (err) {
      // Concurrent Lobby provision POSTs can race on externalMatchId; treat as idempotent.
      if (isDuplicateExternalMatchId(err)) {
        const raced = await this.repo.getMatch(assignment.externalMatchId);
        if (raced) return this.sharedState(raced.id);
      }
      throw err;
    }
    await this.hydrateLobbyProfiles(
      match.id,
      assignment.seats.map((s) => s.lobbyUserId),
    );
    return this.sharedState(match.id);
  }

  async claimSeatWithLobbyClaims(
    ref: string,
    claims: AssignmentClaims,
    bodyPlayerName?: string,
  ): Promise<ClaimResult> {
    const match = await this.repo.getMatch(ref);
    if (!match) throw new NotFoundError('match not found');

    const stored = match.lobbyPlayerProfiles[claims.lobbyUserId];
    const profile = await resolveLobbyPlayerProfile({
      stored,
      graphqlUrl: match.lobbyGraphqlUrl,
      serviceToken: match.lobbyServiceToken,
      claims,
    });
    if (profile) {
      await this.repo.setLobbyPlayerProfiles(match.id, { [claims.lobbyUserId]: profile });
    }

    return this.claimSeat(ref, {
      seatKey: claims.seatKey,
      name: claimSeatName(profile, bodyPlayerName),
      lobbyUserId: claims.lobbyUserId,
    });
  }

  /**
   * Token-claim path: the match MUST already be provisioned by a Lobby push.
   * We do not create matches from a token — Lobby owns provisioning, which is
   * what lets it stay in the loop (and reject banned players up front).
   */
  async assertMatchProvisioned(claims: AssignmentClaims): Promise<void> {
    const existing = await this.repo.getMatch(claims.externalMatchId);
    if (!existing) {
      throw new NotFoundError('match not provisioned by Lobby (push required first)');
    }
    if (existing.lobbyId && !lobbyIssuersMatch(claims.lobbyIssuer, existing.lobbyId)) {
      throw new TokenError('token iss does not match match lobbyId');
    }
  }

  // --- Seat claiming --------------------------------------------------------

  async claimSeat(
    idOrCode: string,
    opts: { seatKey: string; name: string; lobbyUserId?: string | null },
  ): Promise<ClaimResult> {
    const match = await this.repo.getMatch(idOrCode);
    if (!match) throw new NotFoundError('match not found');

    const { player } = await this.repo.claimSeat({
      matchId: match.id,
      seatKey: opts.seatKey,
      name: opts.name,
      lobbyUserId: opts.lobbyUserId ?? null,
    });

    // Once every seat is filled, the match is ready to play.
    const seats = await this.repo.listSeats(match.id);
    if (match.status === 'waiting' && seats.every((s) => s.player)) {
      await this.repo.setMatchStatus(match.id, 'playing');
      // The clock starts when the match does, not when the first move arrives.
      await this.startPhase(match.id, match.gameMode, match.currentRound);
    }

    const state = await this.publishState(match.id, player.id);
    const mySeat = state.seats.find((s) => s.player?.id === player.id)!;
    return {
      state,
      you: { playerId: player.id, seatKey: mySeat.seatKey, name: player.name },
    };
  }

  // --- State ----------------------------------------------------------------

  /**
   * `viewerPlayerId` is whose seat the caller is asking as. It changes nothing but
   * `abilities`, which is seat-private; a caller that cannot name a viewer gets the
   * shared view rather than an arbitrary seat's charges.
   */
  async getState(idOrCode: string, viewerPlayerId?: string | null): Promise<MatchState> {
    const match = await this.repo.getMatch(idOrCode);
    if (!match) throw new NotFoundError('match not found');
    // Reading is what makes an expired deadline take effect: the waiting player
    // polls while they wait, so the person who cares drives the policy.
    await this.enforceDeadlines(match.id);
    return viewSnapshotAs(await this.buildSnapshot(match.id), viewerPlayerId ?? null);
  }

  private async buildSnapshot(matchId: string): Promise<MatchSnapshot> {
    const match = (await this.repo.getMatch(matchId))!;
    const seats = await this.repo.listSeats(match.id);
    const results = await this.repo.listResults(match.id);
    const firings = await this.repo.listAbilityFirings(match.id);
    const rawRoundMoves =
      match.status === 'playing'
        ? await this.repo.getMovesForRound(match.id, match.currentRound)
        : {};
    const submittedPlayerIds = Object.keys(rawRoundMoves);
    const need = winsNeeded(match.bestOf);
    // A forfeit ends a match without anyone scoring, so a recorded winner
    // outranks the score-derived one.
    const scoredWinner = seats.find((s) => (s.player?.score ?? 0) >= need);
    // Each seat's delay marks are replayed from the resolved rounds — firings
    // included, since Rust, Thief and Freeze all move marks the moves did not.
    const delays = delaysBySeat(results, seats, firings);
    for (const seat of seats) {
      seat.delays = delays[seat.seatKey];
    }
    return {
      shared: this.publicView({
        match,
        seats,
        results,
        submittedPlayerIds,
        currentRoundMoves: rawRoundMoves,
        matchWinnerSeatKey: match.winnerSeatKey ?? scoredWinner?.seatKey ?? null,
        abilityFirings: disclosedFirings(firings, new Set(results.map((r) => r.round))),
        abilities: {},
        oracle: null,
        serverNow: new Date(this.now()).toISOString(),
      }),
      abilitiesByPlayerId: chargesByPlayerId(seats, results, firings, match.currentRound),
      movesByPlayerId: rawRoundMoves,
      oracleByPlayerId: oracleByPlayerId(match, seats, firings),
    };
  }

  /**
   * Hide in-progress opponent moves; resolved rounds still expose both in `results`.
   * `abilities` and `oracle` are emptied for the same reason and by the same hand —
   * seat-private state is only ever added back by `viewSnapshotAs`, for that seat.
   */
  private publicView(state: MatchState): MatchState {
    return { ...state, currentRoundMoves: {}, abilities: {}, oracle: null };
  }

  /** The shared view, for callers with no seat to view as (provisioning, mostly). */
  private async sharedState(matchId: string): Promise<MatchState> {
    return (await this.buildSnapshot(matchId)).shared;
  }

  /** Build the latest snapshot and broadcast it to live subscribers. */
  private async publishState(matchId: string, viewerPlayerId?: string): Promise<MatchState> {
    const snapshot = await this.buildSnapshot(matchId);
    this.hub?.publish(matchId, snapshot);
    return viewSnapshotAs(snapshot, viewerPlayerId ?? null);
  }

  // --- Gameplay -------------------------------------------------------------

  /**
   * `expectedRound` is the round the caller believed it was playing. A move
   * that arrives after its round has resolved would otherwise be recorded
   * against the *next* one — a move the player never chose for it, committed
   * silently when legal and rejected as a cooldown violation when not.
   *
   * Reachable without the client's auto-commit (a lock-in tapped as the round
   * resolves does the same), but the auto-commit fires on a timer at exactly
   * the moment expiry lands, so it turns a rare race into a systematic one.
   *
   * Optional, so a caller that does not know its round keeps the old behaviour
   * rather than being locked out.
   */
  async submitMove(
    idOrCode: string,
    playerId: string,
    move: unknown,
    expectedRound?: number,
  ): Promise<MatchState> {
    if (!isMove(move)) {
      throw new ValidationError('move must be one of rock, paper, scissors');
    }
    const found = await this.repo.getMatch(idOrCode);
    if (!found) throw new NotFoundError('match not found');
    // Settle any expiry before accepting this move, so a move that arrives after
    // the deadline loses to the policy rather than racing past it.
    await this.enforceDeadlines(found.id);
    const match = (await this.repo.getMatch(found.id))!;
    if (match.status === 'finished') throw new ConflictError('match is already finished');
    if (expectedRound != null && expectedRound !== match.currentRound) {
      throw new ConflictError('round has already moved on');
    }

    const seats = await this.repo.listSeats(match.id);
    const occupied = seats.filter((s) => s.player);
    if (match.status !== 'playing' || occupied.length < seats.length) {
      throw new ConflictError('waiting for all seats to be filled');
    }
    const mySeat = seats.find((s) => s.player?.id === playerId);
    if (!mySeat) throw new NotFoundError('player not in this match');

    // Enforce the cooldown. Asked through `availableMoves` rather than by testing
    // the mark count, so the "you always have something to play" floor is honoured
    // here too — re-deriving the rule is how the two drift apart.
    const results = await this.repo.listResults(match.id);
    const firings = await this.repo.listAbilityFirings(match.id);
    const delays = delaysBySeat(results, seats, firings)[mySeat.seatKey];
    if (!availableMoves(delays).includes(move as Move)) {
      throw new ValidationError(
        `'${move}' is on cooldown (${delays[move]} delay mark${delays[move] === 1 ? '' : 's'})`,
      );
    }

    // Oracle's sub-phase: this is a re-pick, not a first pick. Both moves are
    // already recorded, so the holder's is replaced rather than inserted, and the
    // round resolves on the spot — re-sending the move they already had is how a
    // holder says "keep it" without waiting out the clock.
    if (match.phase === 'oracle') {
      const holders = oracleHoldersIn(seats, firings, match.currentRound);
      if (!holders.some((s) => s.seatKey === mySeat.seatKey)) {
        throw new ConflictError('your move is locked while the round resolves');
      }
      await this.repo.replaceMove({
        matchId: match.id,
        round: match.currentRound,
        playerId,
        move: move as Move,
      });
      // Both seats may hold Oracle — a loadout is per seat, and nothing stops the
      // two matching. Then both are deciding in secret at the same time, and
      // resolving on the first re-pick would both cut the other's sub-phase short
      // and tell them, by the round simply ending, that their opponent had
      // already moved. A mirror waits the clock out, which is the rule the pick
      // phase runs on and for the same reason.
      if (holders.length > 1) return this.publishState(match.id, playerId);
      return this.resolveDuelRound(
        match.id,
        match.currentRound,
        match.bestOf,
        seats,
        await this.repo.getMovesForRound(match.id, match.currentRound),
        results,
        [],
        playerId,
      );
    }

    await this.repo.recordMove({
      matchId: match.id,
      round: match.currentRound,
      playerId,
      move: move as Move,
    });
    // Strikes count a *run* of silence, so playing on time clears it.
    if (mySeat.player!.expiryStrikes > 0) {
      await this.repo.setExpiryStrikes(match.id, playerId, 0);
    }

    const moves = await this.repo.getMovesForRound(match.id, match.currentRound);
    // The projection hands the caller back their own move, so their UI can lock
    // in without the opponent's pick ever being in the payload.
    if (Object.keys(moves).length < occupied.length) {
      return this.publishState(match.id, playerId);
    }

    // Both locked. A charge already spent on Oracle buys a sub-phase here, before
    // anything resolves; every other round goes straight through, unchanged.
    if (await this.enterOracleSubPhase(match, seats, moves, results, firings)) {
      return this.publishState(match.id, playerId);
    }

    return this.resolveDuelRound(
      match.id,
      match.currentRound,
      match.bestOf,
      seats,
      moves,
      results,
      [],
      playerId,
    );
  }

  /**
   * Open Oracle's mid-round sub-phase if this round bought one, and say whether
   * it did.
   *
   * Reached only from a round both players locked in on time. A round that ran
   * out of clock resolves instead: it has already overrun, and granting a further
   * allowance on top would be rewarding the overrun. The holder's charge is spent
   * either way — it was spent when they fired.
   */
  private async enterOracleSubPhase(
    match: Match,
    seats: Seat[],
    moves: Record<string, Move>,
    results: RoundResult[],
    firings: AbilityFiring[],
  ): Promise<boolean> {
    const holders = oracleHoldersIn(seats, firings, match.currentRound);
    if (holders.length === 0) return false;

    // Marks as they stand *entering* the round, which is what the opponent was
    // choosing from — the same basis `submitMove` validates a pick against, so
    // Oracle can never name a move they could not have played.
    const delays = delaysBySeat(results, seats, firings);
    let wroteAny = false;
    // Every holder is named a move, not just the first one found: two Oracles
    // facing each other is a legal pairing, and a holder whose charge was spent
    // to be told nothing would have been robbed by an implementation detail.
    for (const holder of holders) {
      const opponent = seats.find((s) => s.seatKey !== holder.seatKey);
      if (!opponent?.player) continue;
      const named = nameUnplayedMove(
        delays[opponent.seatKey],
        moves[opponent.player.id],
        this.rng,
      );
      // Write-once. Two readers racing in here must not draw two different moves:
      // a holder who could provoke a re-roll would learn the opponent's move as
      // the one the server never names. The loser reads the winner's move back.
      if (
        await this.repo.nameAbilityFiringTarget({
          matchId: match.id,
          seatId: holder.id,
          round: match.currentRound,
          target: named,
        })
      ) {
        wroteAny = true;
      }
    }
    // Only a writer starts the clock, so a reader that lost every race cannot
    // hand the holders a second allowance by resetting the deadline.
    if (wroteAny) await this.startPhase(match.id, match.gameMode, match.currentRound, 'oracle');
    return true;
  }

  /**
   * Spend a charge on the round being played.
   *
   * Its own call rather than a field on the move commit. Oracle (JQ-150) has to
   * fire, show its owner something, and only *then* be picked against, which a
   * firing welded to the commit cannot express — and the other five read the same
   * way round, since Quarantine and Rust are hedges against a move not yet made.
   * Firing after your own lock-in is therefore allowed: the round is still open
   * until the opponent moves, and nothing about the hedge stops being a hedge.
   *
   * There is no withdrawal. The charge is spent whether or not the ability lands —
   * Quarantine's miss costs exactly what its hit costs — so an un-fire path would
   * only ever be a way to buy information and then take the payment back.
   */
  async fireAbility(
    idOrCode: string,
    playerId: string,
    firing: { helperId?: unknown; target?: unknown; source?: unknown; round?: number },
  ): Promise<MatchState> {
    const { helperId } = firing;
    if (typeof helperId !== 'string' || helperId === '') {
      throw new ValidationError('helperId is required');
    }
    const found = await this.repo.getMatch(idOrCode);
    if (!found) throw new NotFoundError('match not found');
    // Settle any expiry before accepting this, exactly as a move does: a firing
    // that arrives after the deadline must lose to the policy rather than land on
    // the round the auto-pick has just resolved.
    await this.enforceDeadlines(found.id);
    const match = (await this.repo.getMatch(found.id))!;
    if (match.status === 'finished') throw new ConflictError('match is already finished');
    if (firing.round != null && firing.round !== match.currentRound) {
      throw new ConflictError('round has already moved on');
    }

    const seats = await this.repo.listSeats(match.id);
    const occupied = seats.filter((s) => s.player);
    if (match.status !== 'playing' || occupied.length < seats.length) {
      throw new ConflictError('waiting for all seats to be filled');
    }
    const mySeat = seats.find((s) => s.player?.id === playerId);
    if (!mySeat) throw new NotFoundError('player not in this match');
    const theirSeat = seats.find((s) => s.seatKey !== mySeat.seatKey);
    if (!theirSeat) throw new ConflictError('firing needs an opponent seat');

    // Asked through `slotsFor`, the same source `rulesFor` compiles its abilities
    // from, so "this seat holds it" cannot drift from "the engine will honour it".
    if (!slotsFor(mySeat.loadout)[helperId]) {
      throw new ValidationError(`this seat does not hold '${helperId}'`);
    }
    // Oracle is declared during the pick phase and pays off after both players
    // lock in, so firing it once the sub-phase is already running is too late —
    // and firing it *into* the sub-phase, where the charge is already spent,
    // would be a second spend on a round that has one slot.
    if (match.phase === 'oracle') {
      throw new ConflictError('the round is already resolving');
    }

    const results = await this.repo.listResults(match.id);
    const allFirings = await this.repo.listAbilityFirings(match.id);
    if (firedIn(allFirings, match.currentRound, mySeat.seatKey).length > 0) {
      throw new ConflictError('this seat already fired an ability this round');
    }
    const charge = chargesNow(
      mySeat.loadout,
      firingRounds(allFirings, mySeat.seatKey, results),
    )[helperId];
    if (!charge?.available) {
      throw new ConflictError(
        charge?.marks == null
          ? `'${helperId}' is spent for this match`
          : `'${helperId}' is not charged (${charge.marks} mark${charge.marks === 1 ? '' : 's'} to go)`,
      );
    }

    const delays = delaysBySeat(results, seats, allFirings);
    const named = namedMovesFor(helperId, firing, {
      own: delays[mySeat.seatKey],
      opponent: delays[theirSeat.seatKey],
    });

    // The repository's one-per-seat-per-round constraint is the authority on a
    // double-spend, not the check above: two taps racing through two connections
    // both pass it, and only one insert survives.
    await this.repo.recordAbilityFiring({
      matchId: match.id,
      seatId: mySeat.id,
      round: match.currentRound,
      helperId,
      target: named.target,
      source: named.source,
    });
    return this.publishState(match.id, playerId);
  }

  /** RPS "duel" resolution: exactly two seats, ordered by position. */
  private async resolveDuelRound(
    matchId: string,
    round: number,
    bestOf: number,
    seats: Seat[],
    moves: Record<string, Move>,
    priorResults: RoundResult[],
    autoPicked: string[] = [],
    viewerPlayerId?: string,
  ): Promise<MatchState> {
    const [seatA, seatB] = seats;
    const playerA = seatA.player!;
    const playerB = seatB.player!;
    // Read rather than passed in: both call sites would otherwise have to fetch
    // firings they do not otherwise need, and an auto-picked round has none.
    const firings = await this.repo.listAbilityFirings(matchId);
    const played: PlayedRound = {
      a: moves[playerA.id],
      b: moves[playerB.id],
      firedA: firedIn(firings, round, seatA.seatKey),
      firedB: firedIn(firings, round, seatB.seatKey),
    };
    // A round has one winner, but the two players can still read it differently —
    // Sharp Practice scores a Scissors mirror for whoever holds it, and both may.
    // `outcome` records the single winner; each score follows that player's reading.
    const { seat: rel, outcomeA, outcomeB } = resolveRound(
      played,
      rulesForSeat(seatA),
      rulesForSeat(seatB),
      {
        roundIndex: priorResults.length,
        lossesA: lossesFor(priorResults, seatA, seatB),
        lossesB: lossesFor(priorResults, seatB, seatA),
      },
    );

    const winningSeatKey = rel === 'draw' ? 'draw' : rel === 'a' ? seatA.seatKey : seatB.seatKey;
    const scores: Record<string, number> = {
      [playerA.id]: playerA.score + (outcomeA === 'win' ? 1 : 0),
      [playerB.id]: playerB.score + (outcomeB === 'win' ? 1 : 0),
    };
    const result: RoundResult = {
      round,
      outcome: winningSeatKey,
      moves: { [playerA.id]: moves[playerA.id], [playerB.id]: moves[playerB.id] },
      autoPicked,
    };
    await this.repo.saveRoundResult({ matchId, result, scores });

    const decided = matchWinner(scores[playerA.id], scores[playerB.id], winsNeeded(bestOf));
    await this.repo.setMatchProgress(matchId, round + 1, decided ? 'finished' : 'playing');
    if (decided) {
      const winnerSeatKey = decided === 'a' ? seatA.seatKey : seatB.seatKey;
      await this.repo.endMatch(matchId, winnerSeatKey, 'played');
      this.presence?.forget(matchId);
      void this.notifyLobbyMatchComplete(matchId, winnerSeatKey, seats);
    } else {
      const match = await this.repo.getMatch(matchId);
      if (match) await this.startPhase(matchId, match.gameMode, round + 1);
    }
    return this.publishState(matchId, viewerPlayerId);
  }

  // --- Deadlines and the idle policy ---------------------------------------

  /**
   * Register a player's live connection, by whatever reference the caller has.
   * Presence is keyed by match id, but every caller holds a join code or an
   * external id instead — resolving it here keeps that mismatch out of the
   * transport layer, where getting it wrong would silently disable the
   * disconnect grace rather than fail.
   */
  async markConnected(ref: string, playerId: string): Promise<void> {
    const match = await this.repo.getMatch(ref);
    if (match) this.presence?.connect(match.id, playerId);
  }

  /** Counterpart to `markConnected`; starts this player's grace period. */
  async markDisconnected(ref: string, playerId: string): Promise<void> {
    const match = await this.repo.getMatch(ref);
    if (match) this.presence?.disconnect(match.id, playerId);
  }

  /** Put a phase on the clock. Rounds open on `pick`; Oracle adds the other one. */
  private async startPhase(
    matchId: string,
    gameMode: string,
    round: number,
    phase: Phase = 'pick',
  ): Promise<void> {
    const startedAt = this.now();
    const deadline = deadlineFor(policyForMode(gameMode), phase, round, startedAt);
    await this.repo.setPhase(
      matchId,
      phase,
      new Date(startedAt).toISOString(),
      new Date(deadline).toISOString(),
    );
  }

  /**
   * Apply the idle policy to a match, if it is due anything.
   *
   * Deliberately lazy: expiry is a pure function of (deadline, now, moves) and
   * is evaluated on every read and every move rather than by a background
   * timer. That keeps it correct across restarts and replicas for free, and the
   * waiting player's own 3s poll is what makes it prompt — when nobody is
   * watching at all, promptness has nobody to serve.
   *
   * Serialized per match: two concurrent readers must not both auto-pick.
   */
  private enforceDeadlines(matchId: string): Promise<void> {
    const inflight = this.enforcing.get(matchId);
    if (inflight) return inflight;
    const run = this.applyIdlePolicy(matchId).finally(() => this.enforcing.delete(matchId));
    this.enforcing.set(matchId, run);
    return run;
  }

  private async applyIdlePolicy(matchId: string): Promise<void> {
    const match = await this.repo.getMatch(matchId);
    if (!match || match.status !== 'playing') return;

    const seats = await this.repo.listSeats(matchId);
    const occupied = seats.filter((s) => s.player);
    if (occupied.length < seats.length) return;

    const moves = await this.repo.getMovesForRound(matchId, match.currentRound);
    const policy = policyForMode(match.gameMode);
    const now = this.now();
    const deadline = match.phaseDeadline ? Date.parse(match.phaseDeadline) : null;

    // Oracle's sub-phase answers to the clock but not to the idle policy. Both
    // players picked on time — the strike system counts a run of silence, and
    // there has been none — so expiry costs nobody a strike and cannot forfeit
    // anyone. It simply resolves the round on the moves as they stand: the
    // holder's original pick, since they did not replace it. The charge stays
    // spent, which is what declining to use what you paid for costs.
    if (match.phase === 'oracle') {
      if (deadline === null || now < deadline) return;
      await this.resolveDuelRound(
        matchId,
        match.currentRound,
        match.bestOf,
        seats,
        moves,
        await this.repo.listResults(matchId),
        [],
      );
      return;
    }

    const verdicts = occupied.map((seat) => ({
      seat,
      action: decidePenalty({
        policy,
        now,
        deadline,
        hasMoved: moves[seat.player!.id] !== undefined,
        strikes: seat.player!.expiryStrikes,
        disconnectedSince: this.presence?.disconnectedSince(matchId, seat.player!.id) ?? null,
      }),
    }));

    const forfeited = verdicts.filter((v) => v.action.kind === 'forfeit');
    if (forfeited.length > 0) {
      await this.forfeitMatch(matchId, seats, verdicts, forfeited);
      return;
    }

    const expired = verdicts.filter((v) => v.action.kind === 'auto-pick');
    if (expired.length === 0) return;

    const results = await this.repo.listResults(matchId);
    const firings = await this.repo.listAbilityFirings(matchId);
    const delays = delaysBySeat(results, seats, firings);
    const autoPicked: string[] = [];
    for (const { seat } of expired) {
      const player = seat.player!;
      const move = chooseAutoPick(delays[seat.seatKey], this.rng);
      try {
        await this.repo.recordMove({
          matchId,
          round: match.currentRound,
          playerId: player.id,
          move,
        });
      } catch (err) {
        // Their own move landed first; the unique constraint says so.
        if (err instanceof ConflictError) continue;
        throw err;
      }
      await this.repo.setExpiryStrikes(matchId, player.id, player.expiryStrikes + 1);
      autoPicked.push(player.id);
    }

    const filled = await this.repo.getMovesForRound(matchId, match.currentRound);
    if (Object.keys(filled).length < occupied.length) {
      await this.publishState(matchId);
      return;
    }
    await this.resolveDuelRound(
      matchId,
      match.currentRound,
      match.bestOf,
      seats,
      filled,
      results,
      autoPicked,
    );
  }

  private async forfeitMatch(
    matchId: string,
    seats: Seat[],
    verdicts: { seat: Seat; action: { kind: string } }[],
    forfeited: { seat: Seat; action: { kind: string } }[],
  ): Promise<void> {
    const everyone = forfeited.length === verdicts.length;
    // Both players went silent — nobody was there to earn the win.
    const winner = everyone ? null : verdicts.find((v) => v.action.kind !== 'forfeit')!.seat;
    const first = forfeited[0].action as { reason?: 'strikes' | 'disconnect' };
    const endReason: MatchEndReason = everyone
      ? 'abandoned'
      : first.reason === 'disconnect'
        ? 'forfeit-disconnect'
        : 'forfeit-strikes';

    await this.repo.endMatch(matchId, winner?.seatKey ?? null, endReason);
    this.presence?.forget(matchId);
    void this.notifyLobbyMatchComplete(matchId, winner?.seatKey ?? null, seats);
    await this.publishState(matchId);
  }

  /** Best-effort callback so Lobby can clear matched queue rows. */
  private async notifyLobbyMatchComplete(
    matchId: string,
    winningSeatKey: string | null,
    seats: Seat[],
  ): Promise<void> {
    const match = await this.repo.getMatch(matchId);
    if (!match?.externalMatchId || !match.lobbyGraphqlUrl || !match.lobbyServiceToken) return;

    const winnerIds: string[] = [];
    if (winningSeatKey) {
      const winner = seats.find((s) => s.seatKey === winningSeatKey);
      const uid = winner?.player?.lobbyUserId;
      if (uid) winnerIds.push(uid);
    }

    await reportMatchResult(
      match.lobbyGraphqlUrl,
      match.lobbyServiceToken,
      match.externalMatchId,
      'COMPLETED',
      winnerIds,
    );
  }

  // --- Helpers --------------------------------------------------------------

  private requireMode(modeKey: string): GameModeManifest {
    const mode = getGameMode(modeKey);
    if (!mode) throw new ValidationError(`unknown game mode: ${modeKey}`);
    return mode;
  }

  private async hydrateLobbyProfiles(matchId: string, lobbyUserIds: string[]): Promise<void> {
    const match = await this.repo.getMatch(matchId);
    if (!match?.lobbyGraphqlUrl || !match.lobbyServiceToken) return;
    const fetched = await fetchLobbyProfilesForUserIds(
      match.lobbyGraphqlUrl,
      match.lobbyServiceToken,
      lobbyUserIds,
    );
    if (Object.keys(fetched).length > 0) {
      await this.repo.setLobbyPlayerProfiles(matchId, fetched);
    }
  }

  private async uniqueCode(): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const code = makeCode();
      if (!(await this.repo.getMatch(code))) return code;
    }
    return makeCode();
  }
}

/** A player's chosen moves across resolved rounds, in round order. */
function playerMoveSequence(results: RoundResult[], playerId: string): Move[] {
  return [...results]
    .sort((a, b) => a.round - b.round)
    .map((r) => r.moves[playerId])
    .filter((m): m is Move => Boolean(m));
}

/**
 * The rules a seat plays by.
 *
 * `duel` is the null loadout and reaches `BASE_RULES` through the same call, so the
 * two modes share every code path rather than branching. The roll is the stored one:
 * a replay has to reach the marks the match reached the first time, and re-throwing
 * it here would make a match's opening depend on when it was read.
 */
function rulesForSeat(seat: Seat): PlayerRules {
  return rulesForSeats(seat, seat)[0];
}

/**
 * The first ability to change the round protocol rather than the marks.
 *
 * The first, not the only one there can be. Anything that reaches a player after
 * their commitment and before the round resolves wants this same window, and a
 * firing the opponent can *see* gets there too — it hands the seat it acts
 * against something to answer, at a moment their pick is already locked. Every
 * ability is secret today, which is the only reason Oracle is alone in here.
 *
 * So the sub-phase below is a class's machinery wearing one card's name. It is
 * spelled Oracle-shaped because a general predicate with exactly one member is
 * harder to read than the member, not because generalising it is a mistake —
 * JQ-239 does that when the second member arrives.
 */
const ORACLE = 'oracle';

/**
 * The seats that spent Oracle on this round.
 *
 * Plural on purpose. A loadout is chosen per seat and nothing makes the two
 * differ, so both players facing each other with Oracle is a legal pairing —
 * rare, but every code path that assumes a single holder is wrong when it lands.
 */
function oracleHoldersIn(seats: Seat[], firings: AbilityFiring[], round: number): Seat[] {
  return seats.filter(
    (s) => s.player && firedIn(firings, round, s.seatKey).some((f) => f.id === ORACLE),
  );
}

/**
 * One seat's firings per resolved round, in round order — the sequence
 * `abilityMarks` folds. Rounds come from `results` rather than from the firings
 * themselves: a round nobody fired in still takes a mark off every charge, so it
 * has to appear in the sequence as an empty entry.
 */
function firingRounds(
  firings: AbilityFiring[],
  seatKey: string,
  results: RoundResult[],
): Firing[][] {
  return [...results]
    .sort((a, b) => a.round - b.round)
    .map((r) => firedIn(firings, r.round, seatKey));
}

/** Every seat's own charge state, keyed by the player who may see it. */
function chargesByPlayerId(
  seats: Seat[],
  results: RoundResult[],
  firings: AbilityFiring[],
  currentRound: number,
): Record<string, AbilityMap> {
  const byPlayer: Record<string, AbilityMap> = {};
  for (const seat of seats) {
    if (!seat.player) continue;
    byPlayer[seat.player.id] = chargesNow(
      seat.loadout,
      firingRounds(firings, seat.seatKey, results),
      firedIn(firings, currentRound, seat.seatKey),
    );
  }
  return byPlayer;
}

/**
 * Oracle's reveal, keyed by the one player entitled to see it.
 *
 * Empty unless the sub-phase is actually running: outside it there is nothing to
 * decide, and once the round resolves the named move becomes public through
 * `abilityFirings` like every other spent ability. Reading the move back from
 * the firing row rather than re-drawing it is the whole safety property — see
 * `nameAbilityFiringTarget`.
 */
function oracleByPlayerId(
  match: Match,
  seats: Seat[],
  firings: AbilityFiring[],
): Record<string, OracleReveal> {
  if (match.phase !== 'oracle') return {};
  const out: Record<string, OracleReveal> = {};
  for (const seat of seats) {
    if (!seat.player) continue;
    const oracle = firedIn(firings, match.currentRound, seat.seatKey).find(
      (f) => f.id === ORACLE,
    );
    if (!oracle) continue;
    out[seat.player.id] = { round: match.currentRound, namedMove: oracle.target ?? null };
  }
  return out;
}

/**
 * What a firing may name, per ability, checked against the marks as they stand
 * *entering* this round — which is what the firing player was looking at, and what
 * `fireEffects` reads when the round resolves.
 *
 * Rejecting here matters because `rulesFor` deliberately ignores a firing it cannot
 * honour: an unchecked bad target would not be a free mark, it would be a charge
 * spent on nothing, and a spent charge does not come back.
 */
function namedMovesFor(
  helperId: string,
  named: { target?: unknown; source?: unknown },
  delays: { own: DelayMap; opponent: DelayMap },
): { target: Move | null; source: Move | null } {
  const { target, source } = named;
  const noSource = () => {
    if (source != null) throw new ValidationError(`'${helperId}' takes no source`);
  };

  switch (helperId) {
    // Fired blind, at a move the opponent has not chosen yet, so every move is a
    // legal guess. That it may miss is the card's price, not a validation failure.
    case 'quarantine': {
      if (!isMove(target)) throw new ValidationError(`'${helperId}' must name a move`);
      noSource();
      return { target, source: null };
    }
    // Rust deepens a cooldown, so it needs one to deepen.
    case 'rust': {
      if (!isMove(target)) throw new ValidationError(`'${helperId}' must name a move`);
      noSource();
      if (delays.opponent[target] <= 0) {
        throw new ValidationError(
          `'${helperId}' needs a move they have on cooldown; '${target}' is clear`,
        );
      }
      return { target, source: null };
    }
    // Thief moves a mark rather than adding one, so it names both ends: one of
    // yours to lift, which must actually carry a mark, and one of theirs to land on.
    case 'thief': {
      if (!isMove(source)) throw new ValidationError(`'${helperId}' must name one of your moves`);
      if (!isMove(target)) {
        throw new ValidationError(`'${helperId}' must name one of their moves`);
      }
      if (delays.own[source] <= 0) {
        throw new ValidationError(
          `'${helperId}' needs a mark of your own to take; '${source}' is clear`,
        );
      }
      return { target, source };
    }
    // Oracle names a move, but the *server* names it, and not until both players
    // have locked in — the whole point is a move the opponent did not play, which
    // is unknowable while they can still change it. A target from the client is
    // refused rather than trusted; `nameAbilityFiringTarget` fills the column in.
    case ORACLE: {
      if (target != null) throw new ValidationError(`'${helperId}' takes no target`);
      noSource();
      return { target: null, source: null };
    }
    // Sacrifice and Freeze act on the round itself, not on a move. Anything an
    // ability has no use for is refused rather than stored and ignored.
    default: {
      if (target != null) throw new ValidationError(`'${helperId}' takes no target`);
      noSource();
      return { target: null, source: null };
    }
  }
}


/** How many resolved rounds this seat has lost. */
function lossesFor(results: RoundResult[], seat: Seat, opponent: Seat): number {
  return results.filter((r) => r.outcome === opponent.seatKey && r.moves[seat.player!.id]).length;
}

/**
 * Delay marks for every seat, replayed from the resolved rounds and the abilities
 * spent in them.
 *
 * A helpers match cannot be replayed one seat at a time — Grudge, Echo Chamber and
 * Small Mercy let one player's round mark the *other* player's moves, so the two
 * sequences are coupled. A duel holds none of those, and DUEL_RULES makes the
 * two-seat replay land on exactly what the old per-seat one produced.
 *
 * The walk itself lives in `replayBoard.ts` rather than here, because the replay
 * page needs the same one and a mirror of it in the frontend is a second rules
 * engine to keep in step (JQ-207).
 */
function delaysBySeat(
  results: RoundResult[],
  seats: Seat[],
  firings: readonly AbilityFiring[],
): Record<string, DelayMap> {
  if (seats.length !== 2) {
    // No mode has anything but two seats today. If one ever does, it keeps the old
    // per-seat replay rather than silently being handed a two-player one.
    return Object.fromEntries(
      seats.map((s) => [
        s.seatKey,
        computeDelays(s.player ? playerMoveSequence(results, s.player.id) : []),
      ]),
    );
  }
  const [seatA, seatB] = seats;
  const a = reconstructionSeat(seatA);
  const b = reconstructionSeat(seatB);
  const rounds = a && b ? playedRoundsFrom(results, firings, a, b) : [];
  const board = boardsThroughMatch(rounds, ...rulesForSeats(seatA, seatB)).at(-1)!;
  return { [seatA.seatKey]: board.a, [seatB.seatKey]: board.b };
}

/** A claimed seat as the shared reconstruction wants it; null while it is empty. */
function reconstructionSeat(seat: Seat): ReconstructionSeat | null {
  if (!seat.player) return null;
  return {
    seatKey: seat.seatKey,
    playerId: seat.player.id,
    loadout: seat.loadout,
    loadoutRoll: seat.loadoutRoll,
  };
}

function seatsFromMode(mode: GameModeManifest): SeatReservation[] {
  return seatKeysForMode(mode).map((seatKey, i) => ({
    seatKey,
    teamKey: null,
    role: null,
    position: i,
    reservedForLobbyUser: null,
  }));
}

function assertAssignmentCoversMode(mode: GameModeManifest, assigned: AssignmentSeat[]): void {
  const byKey = new Set(assigned.map((a) => a.seatKey));
  for (const seatKey of seatKeysForMode(mode)) {
    if (!byKey.has(seatKey)) {
      throw new ValidationError(`assignment missing seat '${seatKey}' for mode '${mode.key}'`);
    }
  }
  const seenUsers = new Set<string>();
  for (const a of assigned) {
    if (seenUsers.has(a.lobbyUserId)) {
      throw new ValidationError(`duplicate lobbyUserId in assignment: ${a.lobbyUserId}`);
    }
    seenUsers.add(a.lobbyUserId);
  }
}

function reservationsFromAssignment(mode: GameModeManifest, assigned: AssignmentSeat[]): SeatReservation[] {
  const byKey = new Map(assigned.map((a) => [a.seatKey, a]));
  const keys = seatKeysForMode(mode);
  for (const a of assigned) {
    if (!keys.includes(a.seatKey)) {
      throw new ValidationError(`assignment references unknown seat '${a.seatKey}' for mode '${mode.key}'`);
    }
  }
  return keys.map((seatKey, i) => ({
    seatKey,
    teamKey: null,
    role: null,
    position: i,
    reservedForLobbyUser: byKey.get(seatKey)?.lobbyUserId ?? null,
  }));
}

function clampBestOf(bestOf: number | undefined, fallback: number): number {
  const n = Number(bestOf ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.min(9, Math.max(1, Math.round(n)));
  return clamped % 2 === 0 ? clamped + 1 : clamped;
}

/** Postgres unique violation on matches.external_match_id from concurrent provision POSTs. */
function isDuplicateExternalMatchId(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.message.includes('matches_external_match_id_key');
}
