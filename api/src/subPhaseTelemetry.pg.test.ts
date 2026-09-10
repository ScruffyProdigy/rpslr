/**
 * JQ-262's pacing views, against a real Postgres.
 *
 * The mid-round sub-phase is a pause in a game built on simultaneous commitment,
 * so how often it happens is a pacing budget. These views count the spend, and —
 * like the rest of JQ-152's telemetry — they are a derivation rather than a write
 * path, so the only way to know they are right is to play matches through the real
 * service and read the aggregates back.
 *
 * Its own schema and its own file rather than a block inside `telemetry.pg.test.ts`:
 * these matches exist to pause, and dropping them into that file's shared fixture
 * would move every count it asserts.
 *
 * Skipped when `DATABASE_URL` is unset, exactly as its sibling is.
 */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgGameRepository } from './pgRepository.js';
import { GameService } from './service.js';

const databaseUrl = process.env.DATABASE_URL;
const SCHEMA = 'jq262_subphase_test';
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

const loadout = (seatKey: string, ...optionIds: string[]) => ({
  seatKey,
  options: [{ groupKey: 'helpers', optionIds }],
});

describe.skipIf(!databaseUrl)('JQ-262 sub-phase pacing views', () => {
  let pool: Pool;
  let repo: PgGameRepository;
  let service: GameService;
  let now: number;

  /** Match ids, by the letter each is described under below. */
  const id: Record<string, string> = {};

  const num = (value: unknown) => (value === null ? null : Number(value));

  async function rows(sql: string): Promise<Record<string, unknown>[]> {
    return (await pool.query(sql)).rows;
  }

  async function one(sql: string): Promise<Record<string, unknown> | undefined> {
    return (await rows(sql))[0];
  }

  /** A match's row from the budget view, with the counts already numeric. */
  async function budget(key: string) {
    const row = await one(`SELECT * FROM v_sub_phase_budget WHERE match_id = '${id[key]}'`);
    return {
      rounds: num(row?.rounds),
      subPhases: num(row?.sub_phases),
      fromReveal: num(row?.from_reveal),
      fromPublicFiring: num(row?.from_public_firing),
      fromBoth: num(row?.from_both),
      pausedRoundShare: num(row?.paused_round_share),
    };
  }

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
    // Without the sync the two columns these views read are NULL for every card and
    // every match looks unpaused — which is the failure mode worth being loud about.
    await repo.syncHelperCatalog();
    now = Date.parse('2026-01-01T00:00:00.000Z');
    service = new GameService(repo, { now: () => now, rng: () => 0 });

    /** Seat both players and hand back the codes and ids. */
    async function match(key: string, alice: string[], bob: string[], bestOf = 1) {
      const created = await service.createStandaloneMatch({
        gameMode: 'duel-helpers',
        hostName: 'Alice',
        bestOf,
        seats: [loadout('1', ...alice), loadout('2', ...bob)],
      });
      const joined = await service.claimSeat(created.state.match.code, {
        seatKey: '2',
        name: 'Bob',
      });
      id[key] = created.state.match.id;
      return {
        code: created.state.match.code,
        alice: created.you.playerId,
        bob: joined.you.playerId,
      };
    }

    // --- A: a reveal to its own holder, and nothing public ---------------------
    // Oracle is `secret` on the disclosure axis and still buys a pause, because it
    // tells the seat that fired it something. The two axes are independent, and A
    // and B are the pair that proves the view reads both.
    const a = await match('A', ['oracle', 'copycat'], ['thief', 'watchful']);
    await service.fireAbility(a.code, a.alice, { helperId: 'oracle' });
    await service.submitMove(a.code, a.alice, 'rock');
    await service.submitMove(a.code, a.bob, 'scissors');
    // Alice is the only entitled seat; she stands on Rock and the round resolves.
    await service.submitMove(a.code, a.alice, 'rock');

    // --- B: a public firing, and no reveal -------------------------------------
    const b = await match('B', ['quarantine', 'copycat'], ['thief', 'watchful']);
    await service.fireAbility(b.code, b.alice, { helperId: 'quarantine', target: 'scissors' });
    await service.submitMove(b.code, b.alice, 'rock');
    await service.submitMove(b.code, b.bob, 'scissors');
    // Bob holds the window here — it is the seat a public firing acts against.
    await service.submitMove(b.code, b.bob, 'scissors');

    // --- C: both causes in one round -------------------------------------------
    // One pause, two reasons. The rule is one sub-phase per round however many
    // entitlements it holds, so this is the match that catches a view summing the
    // two cause columns into a pause count.
    const c = await match('C', ['oracle', 'quarantine'], ['thief', 'watchful']);
    await service.fireAbility(c.code, c.alice, { helperId: 'oracle' });
    await service.fireAbility(c.code, c.alice, { helperId: 'quarantine', target: 'scissors' });
    await service.submitMove(c.code, c.alice, 'rock');
    await service.submitMove(c.code, c.bob, 'scissors');
    // Both seats are entitled, so the round waits on both.
    await service.submitMove(c.code, c.alice, 'rock');
    await service.submitMove(c.code, c.bob, 'scissors');

    // --- D: a secret firing that reveals nothing to its holder ------------------
    // A charge is spent and the round costs no pause at all. Recorded through the
    // repository rather than fired, so the card's own targeting rules stay out of a
    // test about SQL.
    const d = await match('D', ['rust', 'copycat'], ['thief', 'watchful']);
    const dState = await service.getState(d.code);
    await repo.recordAbilityFiring({
      matchId: dState.match.id,
      seatId: dState.seats[0].id,
      round: 1,
      helperId: 'rust',
      target: 'scissors',
      // Thief alone moves a mark rather than adding one, so only Thief names a
      // source. Explicit here because this file is type-checked.
      source: null,
    });
    await service.submitMove(d.code, d.alice, 'rock');
    await service.submitMove(d.code, d.bob, 'scissors');

    // --- E: a qualifying firing in a round that ran out of clock ----------------
    // The subtle one. Bob never picks, so `enforceDeadlines` auto-picks for him and
    // resolves the round straight away — `enterSubPhase` is never reached, because a
    // round that has already overrun does not also get the extra allowance. The
    // firing is there in `ability_firings` and bought no pause, and a view reading
    // the firings alone would count it.
    const e = await match('E', ['quarantine', 'copycat'], ['thief', 'watchful']);
    await service.fireAbility(e.code, e.alice, { helperId: 'quarantine', target: 'scissors' });
    // Paper, so that the auto-pick (Rock, with `rng` pinned to the first live move)
    // loses and the match actually finishes — an unfinished match is not in the
    // budget view at all, which would make this assertion pass for the wrong reason.
    await service.submitMove(e.code, e.alice, 'paper');
    now += 120_000;
    await service.getState(e.code);
  }, 30_000);

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.end();
  });

  it('mirrors both disclosure axes out of the roster', async () => {
    const openers = await rows(
      `SELECT id FROM helper_catalog
       WHERE informs_its_holder OR reveal = 'public'
       ORDER BY id`,
    );
    expect(openers.map((r) => r.id)).toEqual(['freeze', 'oracle', 'quarantine']);
    // A passive withholds nothing, so it has no disclosure rather than a secret one.
    const passives = await one(
      `SELECT COUNT(*) AS n FROM helper_catalog WHERE load_kind = 'passive' AND reveal IS NOT NULL`,
    );
    expect(num(passives?.n)).toBe(0);
  });

  it('counts a reveal to its own holder as a pause', async () => {
    expect(await budget('A')).toEqual({
      rounds: 1,
      subPhases: 1,
      fromReveal: 1,
      fromPublicFiring: 0,
      fromBoth: 0,
      pausedRoundShare: 1,
    });
  });

  it('counts a public firing as a pause, against the seat it acts on', async () => {
    expect(await budget('B')).toEqual({
      rounds: 1,
      subPhases: 1,
      fromReveal: 0,
      fromPublicFiring: 1,
      fromBoth: 0,
      pausedRoundShare: 1,
    });
  });

  it('counts a round with both causes once, and says it had both', async () => {
    expect(await budget('C')).toEqual({
      rounds: 1,
      subPhases: 1,
      fromReveal: 1,
      fromPublicFiring: 1,
      fromBoth: 1,
      pausedRoundShare: 1,
    });
  });

  it('charges nothing for a secret firing that tells its holder nothing', async () => {
    expect(await budget('D')).toEqual({
      rounds: 1,
      subPhases: 0,
      fromReveal: 0,
      fromPublicFiring: 0,
      fromBoth: 0,
      pausedRoundShare: 0,
    });
  });

  it('charges nothing for a round that ran out of clock before the window', async () => {
    // The firing happened and is on the table; the pause never did.
    const fired = await one(
      `SELECT COUNT(*) AS n FROM ability_firings WHERE match_id = '${id.E}'`,
    );
    expect(num(fired?.n)).toBe(1);
    expect(await budget('E')).toMatchObject({ rounds: 1, subPhases: 0 });
  });

  it('names the cards that bought the pauses, and only those', async () => {
    const sources = await rows('SELECT * FROM v_sub_phase_sources');
    const byId = Object.fromEntries(sources.map((r) => [r.helper_id, r]));

    // Oracle paused A and C; Quarantine paused B and C. Rust bought no pause, so it
    // is absent rather than a zero row — it is not part of this question.
    expect(Object.keys(byId).sort()).toEqual(['oracle', 'quarantine']);
    expect(num(byId.oracle.firings)).toBe(2);
    expect(num(byId.oracle.rounds_paused)).toBe(2);
    // Quarantine fired three times and paused two rounds: E's charge was spent into
    // a round that had already run out of clock and bought nothing. That gap is the
    // column's reason for existing.
    expect(num(byId.quarantine.firings)).toBe(3);
    expect(num(byId.quarantine.rounds_paused)).toBe(2);
  });
});
