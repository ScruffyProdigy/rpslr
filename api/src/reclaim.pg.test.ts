/**
 * The re-claim rule, against a real Postgres.
 *
 * `MemoryGameRepository` is held to the same contract in `reconnect.test.ts`,
 * which is what the HTTP tests run on. This half is the one that matters in
 * production: the claim path here is a `FOR UPDATE` transaction, and the order
 * it checks occupancy and reservation in decides whether a returning player is
 * handed their seat or a `409`. A rule only ever exercised against an in-memory
 * array is a rule that has not been tested where it runs.
 *
 * Skipped when `DATABASE_URL` is unset, so `npm test` on a laptop with no
 * database is unchanged. CI sets it, so it runs there for real.
 */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgGameRepository } from './pgRepository.js';
import { ConflictError, ReservationError } from './repository.js';

const databaseUrl = process.env.DATABASE_URL;
const SCHEMA = 'jq258_reclaim_test';
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

describe.skipIf(!databaseUrl)('JQ-258 re-claiming a held seat', () => {
  let pool: Pool;
  let repo: PgGameRepository;
  let matchId: string;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: databaseUrl });
    try {
      await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
      await admin.query(`CREATE SCHEMA ${SCHEMA}`);
    } finally {
      await admin.end();
    }
    pool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${SCHEMA},public`,
    });
    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
      .sort();
    for (const file of files) {
      await pool.query(await readFile(join(migrationsDir, file), 'utf8'));
    }

    repo = new PgGameRepository(pool);
    const match = await repo.createMatch({
      code: 'RPS-J258',
      name: 'reclaim',
      gameMode: 'duel',
      bestOf: 5,
      seats: [
        { seatKey: '1', position: 0, reservedForLobbyUser: 'u_alice' },
        { seatKey: '2', position: 1, reservedForLobbyUser: 'u_bob' },
      ],
    });
    matchId = match.id;
  });

  afterAll(async () => {
    await pool?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await repo?.close();
  });

  it('hands the same player back the seat they already hold', async () => {
    const first = await repo.claimSeat({
      matchId,
      seatKey: '1',
      name: 'Alice',
      lobbyUserId: 'u_alice',
    });
    expect(first.reclaimed).toBe(false);

    const again = await repo.claimSeat({
      matchId,
      seatKey: '1',
      name: 'Alice',
      lobbyUserId: 'u_alice',
    });

    expect(again.reclaimed).toBe(true);
    expect(again.player.id).toBe(first.player.id);
    expect(again.seat.seatKey).toBe('1');
  });

  it('refuses a different player reaching for that occupied seat', async () => {
    await expect(
      repo.claimSeat({ matchId, seatKey: '1', name: 'Mallory', lobbyUserId: 'u_mallory' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('still calls an empty seat held for someone else a reservation, not a conflict', async () => {
    // Seat 2 is reserved for Bob and nobody is sitting in it. That is a
    // different refusal from the one above, and Lobby reads the two apart.
    await expect(
      repo.claimSeat({ matchId, seatKey: '2', name: 'Mallory', lobbyUserId: 'u_mallory' }),
    ).rejects.toBeInstanceOf(ReservationError);
  });

  it('writes no second player row for a re-claim', async () => {
    const { rows } = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM players WHERE match_id = $1',
      [matchId],
    );
    expect(rows[0].count).toBe('1');
  });
});
