import { randomUUID } from 'node:crypto';
import type { Move } from './game.js';
import {
  ConflictError,
  NotFoundError,
  ReservationError,
  type ClaimSeatInput,
  type CreateMatchInput,
  type GameRepository,
} from './repository.js';
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
} from './types.js';
import type { Loadout } from './helpers/loadout.js';

interface SeatRow {
  id: string;
  matchId: string;
  seatKey: string;
  teamKey: string | null;
  role: string | null;
  position: number;
  reservedForLobbyUser: string | null;
  loadout: Loadout | null;
  loadoutRoll: Move | null;
}

interface AbilityFiringRow {
  matchId: string;
  seatId: string;
  round: number;
  helperId: string;
  target: Move | null;
  source: Move | null;
}

interface PlayerRow {
  id: string;
  matchId: string;
  seatId: string;
  name: string;
  lobbyUserId: string | null;
  score: number;
  expiryStrikes: number;
}

interface MoveRow {
  matchId: string;
  round: number;
  playerId: string;
  move: Move;
}

/** In-memory repository for tests and standalone fallback. Not persistent. */
export class MemoryGameRepository implements GameRepository {
  private matches = new Map<string, Match>();
  private seats: SeatRow[] = [];
  private players: PlayerRow[] = [];
  private moves: MoveRow[] = [];
  private results = new Map<string, RoundResult[]>();
  private abilityFirings: AbilityFiringRow[] = [];

  async createMatch(input: CreateMatchInput): Promise<Match> {
    const id = randomUUID();
    const match: Match = {
      id,
      code: input.code,
      externalMatchId: input.externalMatchId ?? null,
      lobbyId: input.lobbyId ?? null,
      lobbyReturnUrl: input.lobbyReturnUrl ?? null,
      lobbyGraphqlUrl: input.lobbyGraphqlUrl ?? null,
      lobbyServiceToken: input.lobbyServiceToken ?? null,
      lobbyPlayerProfiles: { ...(input.lobbyPlayerProfiles ?? {}) },
      name: input.name,
      gameMode: input.gameMode,
      status: 'waiting',
      bestOf: input.bestOf,
      currentRound: 1,
      phase: null,
      phaseStartedAt: null,
      phaseDeadline: null,
      endReason: null,
      winnerSeatKey: null,
      createdAt: new Date().toISOString(),
    };
    this.matches.set(id, match);
    for (const s of input.seats) {
      this.seats.push({
        id: randomUUID(),
        matchId: id,
        seatKey: s.seatKey,
        teamKey: s.teamKey ?? null,
        role: s.role ?? null,
        position: s.position,
        reservedForLobbyUser: s.reservedForLobbyUser ?? null,
        loadout: s.loadout ?? null,
        loadoutRoll: s.loadoutRoll ?? null,
      });
    }
    this.results.set(id, []);
    return match;
  }

  async setLobbyPlayerProfiles(
    matchId: string,
    profiles: Record<string, LobbyPlayerProfile>,
  ): Promise<void> {
    const m = this.matches.get(matchId);
    if (m) m.lobbyPlayerProfiles = { ...m.lobbyPlayerProfiles, ...profiles };
  }

  async getMatch(idOrCodeOrExternal: string): Promise<Match | null> {
    return (
      [...this.matches.values()].find(
        (m) =>
          m.id === idOrCodeOrExternal ||
          m.code === idOrCodeOrExternal ||
          m.externalMatchId === idOrCodeOrExternal,
      ) ?? null
    );
  }

  async listSeats(matchId: string): Promise<Seat[]> {
    return this.seats
      .filter((s) => s.matchId === matchId)
      .sort((a, b) => a.position - b.position)
      .map((s) => this.toSeat(s));
  }

  private toSeat(s: SeatRow): Seat {
    const match = this.matches.get(s.matchId);
    const player = this.players.find((p) => p.seatId === s.id) ?? null;
    const lobbyProfile =
      s.reservedForLobbyUser && match
        ? (match.lobbyPlayerProfiles[s.reservedForLobbyUser] ?? null)
        : null;
    return {
      id: s.id,
      matchId: s.matchId,
      seatKey: s.seatKey,
      teamKey: s.teamKey,
      role: s.role,
      position: s.position,
      reservedForLobbyUser: s.reservedForLobbyUser,
      lobbyProfile,
      player: player ? this.toSeatPlayer(player, lobbyProfile) : null,
      delays: {}, // filled in by the service (derived from round history)
      loadout: s.loadout,
      loadoutRoll: s.loadoutRoll,
    };
  }

  private toSeatPlayer(
    p: PlayerRow,
    lobbyProfile: LobbyPlayerProfile | null,
  ): SeatPlayer {
    return {
      id: p.id,
      name: p.name,
      lobbyUserId: p.lobbyUserId,
      score: p.score,
      profile: lobbyProfile,
      expiryStrikes: p.expiryStrikes,
    };
  }

  async claimSeat(input: ClaimSeatInput): Promise<{ seat: Seat; player: SeatPlayer }> {
    // Idempotent: same Lobby user re-claiming returns their existing seat.
    if (input.lobbyUserId) {
      const existing = this.players.find(
        (p) => p.matchId === input.matchId && p.lobbyUserId === input.lobbyUserId,
      );
      if (existing) {
        const seatRow = this.seats.find((s) => s.id === existing.seatId)!;
        const seat = this.toSeat(seatRow);
        return { seat, player: this.toSeatPlayer(existing, seat.lobbyProfile) };
      }
    }

    const seat = this.seats.find(
      (s) => s.matchId === input.matchId && s.seatKey === input.seatKey,
    );
    if (!seat) throw new NotFoundError('seat not found');

    if (seat.reservedForLobbyUser && seat.reservedForLobbyUser !== input.lobbyUserId) {
      throw new ReservationError('seat is reserved for another player');
    }
    if (this.players.some((p) => p.seatId === seat.id)) {
      throw new ConflictError('seat already taken');
    }

    const player: PlayerRow = {
      id: randomUUID(),
      matchId: input.matchId,
      seatId: seat.id,
      name: input.name,
      lobbyUserId: input.lobbyUserId ?? null,
      score: 0,
      expiryStrikes: 0,
    };
    this.players.push(player);
    const claimedSeat = this.toSeat(seat);
    return { seat: claimedSeat, player: this.toSeatPlayer(player, claimedSeat.lobbyProfile) };
  }

  async setMatchStatus(matchId: string, status: MatchStatus): Promise<void> {
    const m = this.matches.get(matchId);
    if (m) m.status = status;
  }

  async setMatchProgress(matchId: string, currentRound: number, status: MatchStatus) {
    const m = this.matches.get(matchId);
    if (m) {
      m.currentRound = currentRound;
      m.status = status;
    }
  }

  async setPhase(
    matchId: string,
    phase: Phase | null,
    startedAtIso: string | null,
    deadlineIso: string | null,
  ): Promise<void> {
    const m = this.matches.get(matchId);
    if (m) {
      m.phase = phase;
      m.phaseStartedAt = startedAtIso;
      m.phaseDeadline = deadlineIso;
    }
  }

  async setExpiryStrikes(matchId: string, playerId: string, strikes: number): Promise<void> {
    const p = this.players.find((row) => row.matchId === matchId && row.id === playerId);
    if (p) p.expiryStrikes = strikes;
  }

  async endMatch(
    matchId: string,
    winnerSeatKey: string | null,
    endReason: MatchEndReason,
  ): Promise<void> {
    const m = this.matches.get(matchId);
    if (m) {
      m.status = 'finished';
      m.winnerSeatKey = winnerSeatKey;
      m.endReason = endReason;
      m.phase = null;
      m.phaseStartedAt = null;
      m.phaseDeadline = null;
    }
  }

  async recordMove(input: MoveRow): Promise<void> {
    const existing = this.moves.find(
      (m) =>
        m.matchId === input.matchId &&
        m.round === input.round &&
        m.playerId === input.playerId,
    );
    if (existing) throw new ConflictError('move already submitted for this round');
    this.moves.push({ ...input });
  }

  async replaceMove(input: MoveRow): Promise<void> {
    const existing = this.moves.find(
      (m) =>
        m.matchId === input.matchId &&
        m.round === input.round &&
        m.playerId === input.playerId,
    );
    // Nothing to replace is a caller error, not an insert: only Oracle's
    // sub-phase reaches this, and it runs strictly after both moves are in.
    if (!existing) throw new NotFoundError('no move to replace for this round');
    existing.move = input.move;
  }

  async getMovesForRound(matchId: string, round: number): Promise<Record<string, Move>> {
    const out: Record<string, Move> = {};
    for (const m of this.moves) {
      if (m.matchId === matchId && m.round === round) out[m.playerId] = m.move;
    }
    return out;
  }

  async saveRoundResult(input: {
    matchId: string;
    result: RoundResult;
    scores: Record<string, number>;
  }): Promise<void> {
    const list = this.results.get(input.matchId) ?? [];
    list.push(input.result);
    this.results.set(input.matchId, list);
    for (const p of this.players) {
      if (input.scores[p.id] !== undefined) p.score = input.scores[p.id];
    }
  }

  async listResults(matchId: string): Promise<RoundResult[]> {
    return [...(this.results.get(matchId) ?? [])];
  }

  async recordAbilityFiring(input: {
    matchId: string;
    seatId: string;
    round: number;
    helperId: string;
    target: Move | null;
    source: Move | null;
  }): Promise<void> {
    // Mirrors the Postgres unique index, helper id included: a seat holding two
    // charged abilities may fire both in one round, but neither of them twice.
    const clash = this.abilityFirings.find(
      (f) =>
        f.matchId === input.matchId &&
        f.round === input.round &&
        f.seatId === input.seatId &&
        f.helperId === input.helperId,
    );
    if (clash) throw new ConflictError(`this seat already fired '${input.helperId}' this round`);
    this.abilityFirings.push({ ...input });
  }

  async nameAbilityFiringTarget(input: {
    matchId: string;
    seatId: string;
    round: number;
    helperId: string;
    target: Move | null;
  }): Promise<boolean> {
    const firing = this.abilityFirings.find(
      (f) =>
        f.matchId === input.matchId &&
        f.round === input.round &&
        f.seatId === input.seatId &&
        f.helperId === input.helperId,
    );
    // No firing, or one already named: either way this call did not write the
    // target, and a caller that lost the race must read the stored move back
    // rather than overwrite it with a second draw.
    if (!firing || firing.target !== null) return false;
    firing.target = input.target;
    return true;
  }

  async listAbilityFirings(matchId: string): Promise<AbilityFiring[]> {
    const seatKeyById = new Map(
      this.seats.filter((s) => s.matchId === matchId).map((s) => [s.id, s.seatKey]),
    );
    return this.abilityFirings
      .filter((f) => f.matchId === matchId)
      .sort((a, b) => a.round - b.round)
      .map((f) => ({
        round: f.round,
        seatKey: seatKeyById.get(f.seatId) ?? f.seatId,
        helperId: f.helperId,
        target: f.target,
        source: f.source,
      }));
  }

  async close(): Promise<void> {
    /* nothing to close */
  }
}
