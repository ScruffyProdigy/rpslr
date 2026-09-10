import { Pool, type PoolClient } from 'pg';
import type { Move } from './game.js';
import {
  ConflictError,
  NotFoundError,
  ReservationError,
  type ClaimSeatInput,
  type ClaimSeatResult,
  type CreateMatchInput,
  type GameRepository,
} from './repository.js';
import type { LobbyPlayerProfile } from './lobbyProfile.js';
import type { Phase } from './roundPolicy.js';
import { syncHelperCatalog, type CatalogSyncResult } from './helpers/catalogSync.js';
import type {
  AbilityFiring,
  Match,
  MatchEndReason,
  MatchStatus,
  RoundResult,
  Seat,
} from './types.js';
import type { Loadout } from './helpers/loadout.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapMatch(row: any): Match {
  const config =
    row.config && typeof row.config === 'object'
      ? row.config
      : typeof row.config === 'string'
        ? JSON.parse(row.config)
        : {};
  return {
    id: row.id,
    code: row.code,
    externalMatchId: row.external_match_id,
    lobbyId: typeof config.lobbyId === 'string' ? config.lobbyId : null,
    lobbyReturnUrl: typeof config.lobbyReturnUrl === 'string' ? config.lobbyReturnUrl : null,
    lobbyGraphqlUrl: typeof config.lobbyGraphqlUrl === 'string' ? config.lobbyGraphqlUrl : null,
    lobbyServiceToken:
      typeof config.lobbyServiceToken === 'string' ? config.lobbyServiceToken : null,
    lobbyPlayerProfiles:
      config.lobbyPlayerProfiles && typeof config.lobbyPlayerProfiles === 'object'
        ? (config.lobbyPlayerProfiles as Record<string, LobbyPlayerProfile>)
        : {},
    name: row.name,
    gameMode: row.game_mode,
    status: row.status as MatchStatus,
    bestOf: row.best_of,
    currentRound: row.current_round,
    phase: row.phase ?? null,
    phaseStartedAt:
      row.phase_started_at instanceof Date
        ? row.phase_started_at.toISOString()
        : (row.phase_started_at ?? null),
    phaseDeadline:
      row.phase_deadline instanceof Date
        ? row.phase_deadline.toISOString()
        : (row.phase_deadline ?? null),
    endReason: row.end_reason ?? null,
    winnerSeatKey: row.winner_seat_key ?? null,
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Postgres-backed repository. Uses the game's own database (port 5433). */
export class PgGameRepository implements GameRepository {
  constructor(private readonly pool: Pool) {}

  static fromUrl(databaseUrl: string): PgGameRepository {
    return new PgGameRepository(new Pool({ connectionString: databaseUrl }));
  }

  /**
   * Push the roster into `helper_catalog`, which JQ-152's telemetry views read for
   * tiers. Postgres-only and deliberately off `GameRepository`: it is a fact about
   * this backing store, not about the game.
   */
  async syncHelperCatalog(): Promise<CatalogSyncResult> {
    return syncHelperCatalog(this.pool);
  }

  private async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async createMatch(input: CreateMatchInput): Promise<Match> {
    return this.tx(async (client) => {
      const configObj: Record<string, unknown> = {};
      if (input.lobbyId) configObj.lobbyId = input.lobbyId;
      if (input.lobbyReturnUrl) configObj.lobbyReturnUrl = input.lobbyReturnUrl;
      if (input.lobbyGraphqlUrl) configObj.lobbyGraphqlUrl = input.lobbyGraphqlUrl;
      if (input.lobbyServiceToken) configObj.lobbyServiceToken = input.lobbyServiceToken;
      if (input.lobbyPlayerProfiles && Object.keys(input.lobbyPlayerProfiles).length > 0) {
        configObj.lobbyPlayerProfiles = input.lobbyPlayerProfiles;
      }
      const config = Object.keys(configObj).length > 0 ? JSON.stringify(configObj) : '{}';
      const matchRes = await client.query(
        `INSERT INTO matches (code, external_match_id, name, game_mode, status, best_of, current_round, config)
         VALUES ($1, $2, $3, $4, 'waiting', $5, 1, $6::jsonb) RETURNING *`,
        [input.code, input.externalMatchId ?? null, input.name, input.gameMode, input.bestOf, config],
      );
      const match = mapMatch(matchRes.rows[0]);
      for (const s of input.seats) {
        await client.query(
          `INSERT INTO seats (match_id, seat_key, team_key, role, position, reserved_for_lobby_user,
                              loadout, loadout_roll)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
          [
            match.id,
            s.seatKey,
            s.teamKey ?? null,
            s.role ?? null,
            s.position,
            s.reservedForLobbyUser ?? null,
            s.loadout ? JSON.stringify(s.loadout) : null,
            s.loadoutRoll ?? null,
          ],
        );
      }
      return match;
    });
  }

  async setLobbyPlayerProfiles(
    matchId: string,
    profiles: Record<string, LobbyPlayerProfile>,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE matches SET config = COALESCE(config, '{}'::jsonb) || jsonb_build_object(
         'lobbyPlayerProfiles', COALESCE(config->'lobbyPlayerProfiles', '{}'::jsonb) || $2::jsonb
       ) WHERE id = $1`,
      [matchId, JSON.stringify(profiles)],
    );
  }

  async getMatch(idOrCodeOrExternal: string): Promise<Match | null> {
    const res = await this.pool.query(
      `SELECT * FROM matches WHERE code = $1 OR external_match_id = $1
       OR id::text = $1 LIMIT 1`,
      [idOrCodeOrExternal],
    );
    return res.rowCount ? mapMatch(res.rows[0]) : null;
  }

  async listSeats(matchId: string): Promise<Seat[]> {
    const match = await this.getMatch(matchId);
    const profiles = match?.lobbyPlayerProfiles ?? {};
    const res = await this.pool.query(
      `SELECT s.*, p.id AS player_id, p.name AS player_name,
              p.lobby_user_id AS player_lobby_user_id, p.score AS player_score,
              p.expiry_strikes AS player_expiry_strikes
       FROM seats s
       LEFT JOIN players p ON p.seat_id = s.id
       WHERE s.match_id = $1
       ORDER BY s.position ASC`,
      [matchId],
    );
    /* eslint-disable @typescript-eslint/no-explicit-any */
    return res.rows.map((row: any): Seat => {
      const lobbyProfile = row.reserved_for_lobby_user
        ? (profiles[row.reserved_for_lobby_user] ?? null)
        : null;
      return {
        id: row.id,
        matchId: row.match_id,
        seatKey: row.seat_key,
        teamKey: row.team_key,
        role: row.role,
        position: row.position,
        reservedForLobbyUser: row.reserved_for_lobby_user,
        lobbyProfile,
        player: row.player_id
          ? {
              id: row.player_id,
              name: row.player_name,
              lobbyUserId: row.player_lobby_user_id,
              score: row.player_score,
              profile: lobbyProfile,
              expiryStrikes: row.player_expiry_strikes ?? 0,
            }
          : null,
        delays: {}, // filled in by the service (derived from round history)
        loadout: parseLoadoutColumn(row.loadout),
        loadoutRoll: row.loadout_roll ?? null,
      };
    });
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }

  async claimSeat(input: ClaimSeatInput): Promise<ClaimSeatResult> {
    return this.tx(async (client) => {
      // Idempotent: same Lobby user re-claiming returns their existing seat.
      if (input.lobbyUserId) {
        const existing = await client.query(
          `SELECT p.id, p.name, p.lobby_user_id, p.score, p.expiry_strikes, p.seat_id
           FROM players p WHERE p.match_id = $1 AND p.lobby_user_id = $2`,
          [input.matchId, input.lobbyUserId],
        );
        if (existing.rowCount) {
          const pr = existing.rows[0];
          const seat = await this.seatById(client, pr.seat_id);
          return {
            seat,
            player: {
              id: pr.id,
              name: pr.name,
              lobbyUserId: pr.lobby_user_id,
              score: pr.score,
              profile: seat.lobbyProfile,
              expiryStrikes: pr.expiry_strikes ?? 0,
            },
            reclaimed: true,
          };
        }
      }

      const seatRes = await client.query(
        `SELECT * FROM seats WHERE match_id = $1 AND seat_key = $2 FOR UPDATE`,
        [input.matchId, input.seatKey],
      );
      if (seatRes.rowCount === 0) throw new NotFoundError('seat not found');
      const seatRow = seatRes.rows[0];

      // Occupancy before reservation: the branch above already answered "you are
      // the one sitting here", so anyone reaching this line with a player in the
      // seat is a different player trying to take it — which is the conflict, and
      // says so plainly, whether or not the seat also carries a reservation.
      const taken = await client.query('SELECT 1 FROM players WHERE seat_id = $1', [seatRow.id]);
      if (taken.rowCount) throw new ConflictError('seat already taken');
      if (seatRow.reserved_for_lobby_user && seatRow.reserved_for_lobby_user !== input.lobbyUserId) {
        throw new ReservationError('seat is reserved for another player');
      }

      const playerRes = await client.query(
        `INSERT INTO players (match_id, seat_id, name, lobby_user_id, score)
         VALUES ($1, $2, $3, $4, 0) RETURNING id, name, lobby_user_id, score, expiry_strikes`,
        [input.matchId, seatRow.id, input.name, input.lobbyUserId ?? null],
      );
      const pr = playerRes.rows[0];
      const seat = await this.seatById(client, seatRow.id);
      return {
        seat,
        player: {
          id: pr.id,
          name: pr.name,
          lobbyUserId: pr.lobby_user_id,
          score: pr.score,
          profile: seat.lobbyProfile,
          expiryStrikes: pr.expiry_strikes ?? 0,
        },
        reclaimed: false,
      };
    });
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  private async seatById(client: PoolClient, seatId: string): Promise<Seat> {
    const res = await client.query(
      `SELECT s.*, p.id AS player_id, p.name AS player_name,
              p.lobby_user_id AS player_lobby_user_id, p.score AS player_score,
              p.expiry_strikes AS player_expiry_strikes
       FROM seats s LEFT JOIN players p ON p.seat_id = s.id WHERE s.id = $1`,
      [seatId],
    );
    const row: any = res.rows[0];
    const match = await this.getMatch(row.match_id);
    const lobbyProfile = row.reserved_for_lobby_user
      ? (match?.lobbyPlayerProfiles[row.reserved_for_lobby_user] ?? null)
      : null;
    return {
      id: row.id,
      matchId: row.match_id,
      seatKey: row.seat_key,
      teamKey: row.team_key,
      role: row.role,
      position: row.position,
      reservedForLobbyUser: row.reserved_for_lobby_user,
      lobbyProfile,
      player: row.player_id
        ? {
            id: row.player_id,
            name: row.player_name,
            lobbyUserId: row.player_lobby_user_id,
            score: row.player_score,
            profile: lobbyProfile,
            expiryStrikes: row.player_expiry_strikes ?? 0,
          }
        : null,
      delays: {}, // filled in by the service (derived from round history)
      loadout: parseLoadoutColumn(row.loadout),
      loadoutRoll: row.loadout_roll ?? null,
    };
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  async setMatchStatus(matchId: string, status: MatchStatus): Promise<void> {
    await this.pool.query('UPDATE matches SET status = $1 WHERE id = $2', [status, matchId]);
  }

  async setMatchProgress(matchId: string, currentRound: number, status: MatchStatus): Promise<void> {
    await this.pool.query('UPDATE matches SET current_round = $1, status = $2 WHERE id = $3', [
      currentRound,
      status,
      matchId,
    ]);
  }

  async setPhase(
    matchId: string,
    phase: Phase | null,
    startedAtIso: string | null,
    deadlineIso: string | null,
  ): Promise<void> {
    await this.pool.query(
      'UPDATE matches SET phase = $1, phase_started_at = $2, phase_deadline = $3 WHERE id = $4',
      [phase, startedAtIso, deadlineIso, matchId],
    );
  }

  async setExpiryStrikes(matchId: string, playerId: string, strikes: number): Promise<void> {
    await this.pool.query(
      'UPDATE players SET expiry_strikes = $1 WHERE id = $2 AND match_id = $3',
      [strikes, playerId, matchId],
    );
  }

  async endMatch(
    matchId: string,
    winnerSeatKey: string | null,
    endReason: MatchEndReason,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE matches
       SET status = 'finished', winner_seat_key = $1, end_reason = $2,
           phase = NULL, phase_started_at = NULL, phase_deadline = NULL
       WHERE id = $3`,
      [winnerSeatKey, endReason, matchId],
    );
  }

  async recordMove(input: {
    matchId: string;
    round: number;
    playerId: string;
    move: Move;
  }): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO moves (match_id, round, player_id, move) VALUES ($1, $2, $3, $4)`,
        [input.matchId, input.round, input.playerId, input.move],
      );
    } catch (err: unknown) {
      if (typeof err === 'object' && err && (err as { code?: string }).code === '23505') {
        throw new ConflictError('move already submitted for this round');
      }
      throw err;
    }
  }

  async replaceMove(input: {
    matchId: string;
    round: number;
    playerId: string;
    move: Move;
  }): Promise<void> {
    const res = await this.pool.query(
      `UPDATE moves SET move = $4 WHERE match_id = $1 AND round = $2 AND player_id = $3`,
      [input.matchId, input.round, input.playerId, input.move],
    );
    // Nothing to replace is a caller error, not an insert: only Oracle's
    // sub-phase reaches this, and it runs strictly after both moves are in.
    if (res.rowCount === 0) throw new NotFoundError('no move to replace for this round');
  }

  async getMovesForRound(matchId: string, round: number): Promise<Record<string, Move>> {
    const res = await this.pool.query(
      'SELECT player_id, move FROM moves WHERE match_id = $1 AND round = $2',
      [matchId, round],
    );
    const out: Record<string, Move> = {};
    for (const row of res.rows) out[row.player_id] = row.move as Move;
    return out;
  }

  async saveRoundResult(input: {
    matchId: string;
    result: RoundResult;
    scores: Record<string, number>;
  }): Promise<void> {
    await this.tx(async (client) => {
      await client.query(
        `INSERT INTO round_results (match_id, round, outcome, moves, auto_picked)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          input.matchId,
          input.result.round,
          input.result.outcome,
          JSON.stringify(input.result.moves),
          JSON.stringify(input.result.autoPicked ?? []),
        ],
      );
      for (const [playerId, score] of Object.entries(input.scores)) {
        await client.query('UPDATE players SET score = $1 WHERE id = $2', [score, playerId]);
      }
    });
  }

  async recordAbilityFiring(input: {
    matchId: string;
    seatId: string;
    round: number;
    helperId: string;
    target: Move | null;
    source: Move | null;
  }): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO ability_firings (match_id, seat_id, round, helper_id, target, source)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [input.matchId, input.seatId, input.round, input.helperId, input.target, input.source],
      );
    } catch (err) {
      // The unique index is the authority on one firing per *slot* per round; a
      // double-tap racing through two connections lands here rather than spending
      // a charge twice. The in-process check cannot do this job — both connections
      // pass it, and only one insert survives.
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictError(`this seat already fired '${input.helperId}' this round`);
      }
      throw err;
    }
  }

  async nameAbilityFiringTarget(input: {
    matchId: string;
    seatId: string;
    round: number;
    helperId: string;
    target: Move | null;
  }): Promise<boolean> {
    // `AND target IS NULL` is the whole point: it makes the draw a
    // write-once, so two readers racing into the sub-phase cannot name two
    // different moves and hand the holder the opponent's move by elimination.
    // `helper_id` joined it in JQ-238: a seat may fire two abilities in one round,
    // and without it this would name whichever of them the planner reached first.
    const res = await this.pool.query(
      `UPDATE ability_firings SET target = $5
        WHERE match_id = $1 AND round = $2 AND seat_id = $3 AND helper_id = $4
          AND target IS NULL`,
      [input.matchId, input.round, input.seatId, input.helperId, input.target],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async listAbilityFirings(matchId: string): Promise<AbilityFiring[]> {
    const res = await this.pool.query(
      `SELECT f.round, f.helper_id, f.target, f.source, s.seat_key
         FROM ability_firings f JOIN seats s ON s.id = f.seat_id
        WHERE f.match_id = $1
        ORDER BY f.round ASC, s.position ASC`,
      [matchId],
    );
    return res.rows.map(
      (row): AbilityFiring => ({
        round: row.round,
        seatKey: row.seat_key,
        helperId: row.helper_id,
        target: row.target ?? null,
        source: row.source ?? null,
      }),
    );
  }

  async recordSubPhaseAction(input: {
    matchId: string;
    seatId: string;
    round: number;
  }): Promise<void> {
    // `ON CONFLICT DO NOTHING` rather than a check-then-insert: re-picking twice
    // inside one window is one act, and two connections racing must not turn a
    // second re-pick into a duplicate-key error the player sees.
    await this.pool.query(
      `INSERT INTO sub_phase_actions (match_id, seat_id, round)
       VALUES ($1, $2, $3)
       ON CONFLICT (match_id, round, seat_id) DO NOTHING`,
      [input.matchId, input.seatId, input.round],
    );
  }

  async listSubPhaseActions(matchId: string, round: number): Promise<string[]> {
    const res = await this.pool.query(
      `SELECT s.seat_key
         FROM sub_phase_actions a JOIN seats s ON s.id = a.seat_id
        WHERE a.match_id = $1 AND a.round = $2
        ORDER BY s.position ASC`,
      [matchId, round],
    );
    return res.rows.map((row) => row.seat_key as string);
  }

  async listResults(matchId: string): Promise<RoundResult[]> {
    const res = await this.pool.query(
      `SELECT round, outcome, moves, auto_picked
       FROM round_results WHERE match_id = $1 ORDER BY round ASC`,
      [matchId],
    );
    return res.rows.map(
      (row): RoundResult => ({
        round: row.round,
        outcome: row.outcome,
        moves: typeof row.moves === 'string' ? JSON.parse(row.moves) : row.moves,
        autoPicked:
          typeof row.auto_picked === 'string'
            ? JSON.parse(row.auto_picked)
            : (row.auto_picked ?? []),
      }),
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * `loadout` is jsonb, which the driver hands back parsed — except when it does not,
 * so this tolerates both rather than depending on which. An absent loadout is a duel
 * seat, not a defect.
 */
function parseLoadoutColumn(raw: unknown): Loadout | null {
  if (raw === null || raw === undefined) return null;
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!Array.isArray(value) || value.length !== 2) return null;
  return [value[0], value[1]] as Loadout;
}
