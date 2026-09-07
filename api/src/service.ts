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
import { TokenError } from './tokens.js';
import { computeDelays, decideRound, isMove, matchWinner, winsNeeded, type Move } from './game.js';
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
  Match,
  MatchEndReason,
  MatchState,
  RoundResult,
  Seat,
  SeatReservation,
} from './types.js';
import type { AssignmentClaims, AssignmentSeat } from './tokens.js';

export class ValidationError extends Error {}

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
  }): Promise<ClaimResult> {
    const mode = this.requireMode(opts.gameMode ?? DEFAULT_GAME_MODE);
    const bestOf = clampBestOf(opts.bestOf, defaultBestOfForMode(mode.key));
    const match = await this.repo.createMatch({
      code: await this.uniqueCode(),
      name: opts.name?.trim() || 'Untitled Match',
      gameMode: mode.key,
      bestOf,
      seats: seatsFromMode(mode),
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
    if (existing) return this.getStateByMatchId(existing.id);

    // Reject the whole roster if it contains any banned player.
    const banned = assignment.seats
      .map((s) => s.lobbyUserId)
      .filter((id) => this.banned.has(id));
    if (banned.length > 0) {
      throw new BannedPlayerError([...new Set(banned)]);
    }

    const mode = this.requireMode(assignment.gameMode);
    assertAssignmentCoversMode(mode, assignment.seats);
    const reservations = reservationsFromAssignment(mode, assignment.seats);
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
        if (raced) return this.getStateByMatchId(raced.id);
      }
      throw err;
    }
    await this.hydrateLobbyProfiles(
      match.id,
      assignment.seats.map((s) => s.lobbyUserId),
    );
    return this.getStateByMatchId(match.id);
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

    const state = await this.publishState(match.id);
    const mySeat = state.seats.find((s) => s.player?.id === player.id)!;
    return {
      state,
      you: { playerId: player.id, seatKey: mySeat.seatKey, name: player.name },
    };
  }

  // --- State ----------------------------------------------------------------

  async getState(idOrCode: string): Promise<MatchState> {
    const match = await this.repo.getMatch(idOrCode);
    if (!match) throw new NotFoundError('match not found');
    // Reading is what makes an expired deadline take effect: the waiting player
    // polls while they wait, so the person who cares drives the policy.
    await this.enforceDeadlines(match.id);
    return this.getStateByMatchId(match.id);
  }

  private async getStateByMatchId(matchId: string): Promise<MatchState> {
    const match = (await this.repo.getMatch(matchId))!;
    const seats = await this.repo.listSeats(match.id);
    const results = await this.repo.listResults(match.id);
    const rawRoundMoves =
      match.status === 'playing'
        ? await this.repo.getMovesForRound(match.id, match.currentRound)
        : {};
    const submittedPlayerIds = Object.keys(rawRoundMoves);
    const need = winsNeeded(match.bestOf);
    // A forfeit ends a match without anyone scoring, so a recorded winner
    // outranks the score-derived one.
    const scoredWinner = seats.find((s) => (s.player?.score ?? 0) >= need);
    // Each seat's delay marks are derived from that player's resolved moves.
    for (const seat of seats) {
      seat.delays = computeDelays(seat.player ? playerMoveSequence(results, seat.player.id) : []);
    }
    return this.publicView({
      match,
      seats,
      results,
      submittedPlayerIds,
      currentRoundMoves: rawRoundMoves,
      matchWinnerSeatKey: match.winnerSeatKey ?? scoredWinner?.seatKey ?? null,
      serverNow: new Date(this.now()).toISOString(),
    });
  }

  /** Hide in-progress opponent moves; resolved rounds still expose both in `results`. */
  private publicView(state: MatchState): MatchState {
    return { ...state, currentRoundMoves: {} };
  }

  /** Build the latest state and broadcast it to live subscribers. */
  private async publishState(matchId: string): Promise<MatchState> {
    const state = await this.getStateByMatchId(matchId);
    this.hub?.publish(matchId, state);
    return state;
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

    // Enforce the cooldown: the chosen move must have 0 delay marks. Delay marks
    // are derived from the player's moves in resolved rounds.
    const results = await this.repo.listResults(match.id);
    const delays = computeDelays(playerMoveSequence(results, playerId));
    if (delays[move] > 0) {
      throw new ValidationError(
        `'${move}' is on cooldown (${delays[move]} delay mark${delays[move] === 1 ? '' : 's'})`,
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
    if (Object.keys(moves).length < occupied.length) {
      const broadcast = await this.publishState(match.id);
      // Echo the caller's move so their UI can lock in without exposing the opponent's pick.
      return { ...broadcast, currentRoundMoves: { [playerId]: move as Move } };
    }

    return this.resolveDuelRound(match.id, match.currentRound, match.bestOf, seats, moves);
  }

  /** RPS "duel" resolution: exactly two seats, ordered by position. */
  private async resolveDuelRound(
    matchId: string,
    round: number,
    bestOf: number,
    seats: Seat[],
    moves: Record<string, Move>,
    autoPicked: string[] = [],
  ): Promise<MatchState> {
    const [seatA, seatB] = seats;
    const playerA = seatA.player!;
    const playerB = seatB.player!;
    const rel = decideRound(moves[playerA.id], moves[playerB.id]);

    const winningSeatKey = rel === 'draw' ? 'draw' : rel === 'a' ? seatA.seatKey : seatB.seatKey;
    const scores: Record<string, number> = {
      [playerA.id]: playerA.score + (rel === 'a' ? 1 : 0),
      [playerB.id]: playerB.score + (rel === 'b' ? 1 : 0),
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
    return this.publishState(matchId);
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

  /** Put the next phase on the clock. */
  private async startPhase(matchId: string, gameMode: string, round: number): Promise<void> {
    const phase: Phase = 'pick';
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
    const autoPicked: string[] = [];
    for (const { seat } of expired) {
      const player = seat.player!;
      const delays = computeDelays(playerMoveSequence(results, player.id));
      const move = chooseAutoPick(delays, this.rng);
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
