/**
 * The double-spend guard, against a real Postgres.
 *
 * The in-process check in `service.ts` cannot be the authority here: two taps
 * racing through two connections both pass it, and only the unique index decides
 * which insert survives. JQ-238 narrowed that index from (match, round, seat) to
 * (match, round, seat, helper) so that a loadout with two charge cards may spend
 * both — and the narrowing must not have traded the guarantee away.
 *
 * `MemoryGameRepository` is asserted against the same rules in `service.test.ts`,
 * so the two implementations are held to one contract. This half is the one that
 * needs a database, because a constraint that is never exercised is a constraint
 * that does not work.
 *
 * Skipped when `DATABASE_URL` is unset, so `npm test` on a laptop with no database
 * is unchanged. CI sets it, so it runs there for real.
 */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgGameRepository } from './pgRepository.js';
import { ConflictError } from './repository.js';

const databaseUrl = process.env.DATABASE_URL;
const SCHEMA = 'jq238_firings_test';
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

describe.skipIf(!databaseUrl)('JQ-238 one firing per ability slot per round', () => {
  let pool: Pool;
  let repo: PgGameRepository;
  let matchId: string;
  let seatId: string;
  let otherSeatId: string;

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
      code: 'RPS-JQ38',
      name: 'firings',
      gameMode: 'duel-helpers',
      bestOf: 5,
      seats: [
        { seatKey: '1', position: 0, loadout: ['rust', 'thief'] },
        { seatKey: '2', position: 1, loadout: ['quarantine', 'poker-face'] },
      ],
    });
    matchId = match.id;
    const seats = await repo.listSeats(matchId);
    seatId = seats[0].id;
    otherSeatId = seats[1].id;
  });

  afterAll(async () => {
    await pool?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await repo?.close();
  });

  const base = (round: number, helperId: string, seat = () => seatId) => ({
    matchId,
    seatId: seat(),
    round,
    helperId,
    target: null,
    source: null,
  });

  it('takes two different abilities from one seat in one round', async () => {
    await repo.recordAbilityFiring(base(1, 'rust'));
    await expect(repo.recordAbilityFiring(base(1, 'thief'))).resolves.toBeUndefined();
  });

  it('refuses the same ability twice in one round', async () => {
    await repo.recordAbilityFiring(base(2, 'rust'));
    await expect(repo.recordAbilityFiring(base(2, 'rust'))).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses a concurrent double-tap, which is the check the process cannot make', async () => {
    // Both inserts are in flight before either has committed, so neither could have
    // seen the other. Exactly one survives.
    const settled = await Promise.allSettled([
      repo.recordAbilityFiring(base(3, 'rust')),
      repo.recordAbilityFiring(base(3, 'rust')),
    ]);
    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it('keeps the key per seat and per round', async () => {
    await repo.recordAbilityFiring(base(4, 'rust'));
    await expect(repo.recordAbilityFiring(base(5, 'rust'))).resolves.toBeUndefined();
    await expect(
      repo.recordAbilityFiring(base(4, 'rust', () => otherSeatId)),
    ).resolves.toBeUndefined();
  });

  it('names the firing it was asked for, once, and leaves its sibling alone', async () => {
    await repo.recordAbilityFiring(base(6, 'freeze'));
    await repo.recordAbilityFiring(base(6, 'oracle'));

    const name = (helperId: string, target: 'paper' | 'lizard') =>
      repo.nameAbilityFiringTarget({ matchId, seatId, round: 6, helperId, target });

    expect(await name('oracle', 'paper')).toBe(true);
    // Write-once: the loser of a race reads false and the stored move stands.
    expect(await name('oracle', 'lizard')).toBe(false);

    const round6 = (await repo.listAbilityFirings(matchId)).filter((f) => f.round === 6);
    expect(round6.find((f) => f.helperId === 'oracle')!.target).toBe('paper');
    expect(round6.find((f) => f.helperId === 'freeze')!.target).toBeNull();
  });
});
