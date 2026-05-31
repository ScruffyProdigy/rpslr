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
import type { Match, MatchStatus, RoundResult, Seat, SeatPlayer } from './types.js';

interface SeatRow {
  id: string;
  matchId: string;
  seatKey: string;
  teamKey: string | null;
  role: string | null;
  position: number;
  reservedForLobbyUser: string | null;
}

interface PlayerRow {
  id: string;
  matchId: string;
  seatId: string;
  name: string;
  lobbyUserId: string | null;
  score: number;
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
      name: input.name,
      gameMode: input.gameMode,
      status: 'waiting',
      bestOf: input.bestOf,
      currentRound: 1,
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
      });
    }
    this.results.set(id, []);
    return match;
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
    const player = this.players.find((p) => p.seatId === s.id) ?? null;
    return {
      id: s.id,
      matchId: s.matchId,
      seatKey: s.seatKey,
      teamKey: s.teamKey,
      role: s.role,
      position: s.position,
      reservedForLobbyUser: s.reservedForLobbyUser,
      player: player ? this.toSeatPlayer(player) : null,
      delays: {}, // filled in by the service (derived from round history)
    };
  }

  private toSeatPlayer(p: PlayerRow): SeatPlayer {
    return { id: p.id, name: p.name, lobbyUserId: p.lobbyUserId, score: p.score };
  }

  async claimSeat(input: ClaimSeatInput): Promise<{ seat: Seat; player: SeatPlayer }> {
    // Idempotent: same Lobby user re-claiming returns their existing seat.
    if (input.lobbyUserId) {
      const existing = this.players.find(
        (p) => p.matchId === input.matchId && p.lobbyUserId === input.lobbyUserId,
      );
      if (existing) {
        const seatRow = this.seats.find((s) => s.id === existing.seatId)!;
        return { seat: this.toSeat(seatRow), player: this.toSeatPlayer(existing) };
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
    };
    this.players.push(player);
    return { seat: this.toSeat(seat), player: this.toSeatPlayer(player) };
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

  async close(): Promise<void> {
    /* nothing to close */
  }
}
