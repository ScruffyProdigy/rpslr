/**
 * JQ-152's views, against a real Postgres.
 *
 * The views are the deliverable, and SQL that is never run is SQL that does not
 * work — so this plays real matches through `GameService` + `PgGameRepository` and
 * reads the aggregates back, rather than asserting anything about the SQL text.
 *
 * It builds its own schema from `migrations/*.up.sql` and drops it afterwards, so
 * it neither sees nor disturbs whatever is in `public`. Aggregate views have no
 * match id to filter on, which is the whole reason for the isolation: a dev
 * database with a few real matches in it would otherwise fail every count here.
 *
 * Skipped when `DATABASE_URL` is unset, so `npm test` on a laptop with no database
 * is unchanged. CI runs Postgres on 5433 and sets it, so it runs there for real.
 */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HELPERS } from './helpers/roster.js';
import { PgGameRepository } from './pgRepository.js';
import { GameService } from './service.js';

const databaseUrl = process.env.DATABASE_URL;
const SCHEMA = 'jq152_telemetry_test';
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** `helpers` is the only pre-queue group `duel-helpers` declares. */
const loadout = (seatKey: string, ...optionIds: string[]) => ({
  seatKey,
  options: [{ groupKey: 'helpers', optionIds }],
});

describe.skipIf(!databaseUrl)('JQ-152 telemetry views', () => {
  let pool: Pool;
  let repo: PgGameRepository;
  let service: GameService;

  /** Every aggregate comes back from pg as a string; the assertions want numbers. */
  const num = (value: unknown) => (value === null ? null : Number(value));

  async function rows(sql: string): Promise<Record<string, unknown>[]> {
    return (await pool.query(sql)).rows;
  }

  async function one(sql: string): Promise<Record<string, unknown> | undefined> {
    return (await rows(sql))[0];
  }

  beforeAll(async () => {
    const admin = new Pool({ connectionString: databaseUrl });
    try {
      await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
      await admin.query(`CREATE SCHEMA ${SCHEMA}`);
    } finally {
      await admin.end();
    }

    // `public` stays on the path for `gen_random_uuid`; the test schema is first,
    // so every table and view the migrations create lands in it.
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
    // The migration leaves the catalog empty on purpose; without this the shape
    // column is NULL for every seat, which is exactly the failure it should cause.
    await repo.syncHelperCatalog();
    service = new GameService(repo, { rng: () => 0 });

    // --- The matches every assertion below reads back --------------------------
    //
    // Helpers are chosen for what they do NOT do: none of these change how a round
    // resolves, so the outcomes are the plain RPSLR ones and the arithmetic in the
    // assertions is about the views rather than about the cards.
    //
    // Quarantine is the one that changes the round's *shape* rather than its result.
    // Since JQ-209 it fires in public, so the seat it names is handed the round's
    // window and the round waits on them — hence the extra `submitMove` in A and B.
    // Each stands on the move it already had, so both outcomes are what they were.

    // A: Quarantine + Copycat beats Oracle + Watchful, and the named move lands.
    const a = await service.createStandaloneMatch({
      gameMode: 'duel-helpers',
      hostName: 'Alice',
      bestOf: 1,
      seats: [loadout('1', 'quarantine', 'copycat'), loadout('2', 'oracle', 'watchful')],
    });
    const aJoin = await service.claimSeat(a.state.match.code, { seatKey: '2', name: 'Bob' });
    const aState = await service.getState(a.state.match.code);
    await repo.recordAbilityFiring({
      matchId: aState.match.id,
      seatId: aState.seats[0].id,
      round: 1,
      helperId: 'quarantine',
      target: 'scissors',
    });
    await service.submitMove(a.state.match.code, a.you.playerId, 'rock');
    await service.submitMove(a.state.match.code, aJoin.you.playerId, 'scissors');
    // Bob answers the public firing by standing on Scissors, so the name still lands.
    await service.submitMove(a.state.match.code, aJoin.you.playerId, 'scissors');

    // B: the same loadout wins again, and this time Quarantine names the wrong move.
    const b = await service.createStandaloneMatch({
      gameMode: 'duel-helpers',
      hostName: 'Cara',
      bestOf: 1,
      seats: [loadout('1', 'quarantine', 'copycat'), loadout('2', 'freeze', 'old-habits')],
    });
    const bJoin = await service.claimSeat(b.state.match.code, { seatKey: '2', name: 'Dan' });
    const bState = await service.getState(b.state.match.code);
    await repo.recordAbilityFiring({
      matchId: bState.match.id,
      seatId: bState.seats[0].id,
      round: 1,
      helperId: 'quarantine',
      target: 'paper',
    });
    await service.submitMove(b.state.match.code, b.you.playerId, 'rock');
    await service.submitMove(b.state.match.code, bJoin.you.playerId, 'lizard');
    // Dan answers it too; Paper was never his move, so the name still misses.
    await service.submitMove(b.state.match.code, bJoin.you.playerId, 'lizard');

    // C: a mirror. Someone wins it, and it still tells us nothing about the loadout.
    const c = await service.createStandaloneMatch({
      gameMode: 'duel-helpers',
      hostName: 'Eve',
      bestOf: 1,
      seats: [loadout('1', 'quarantine', 'copycat'), loadout('2', 'quarantine', 'copycat')],
    });
    const cJoin = await service.claimSeat(c.state.match.code, { seatKey: '2', name: 'Fay' });
    await service.submitMove(c.state.match.code, c.you.playerId, 'rock');
    await service.submitMove(c.state.match.code, cJoin.you.playerId, 'lizard');

    // D: a plain `duel` — the null loadout, on the same path, with a drawn round.
    const d = await service.createStandaloneMatch({ hostName: 'Gus', bestOf: 1 });
    const dJoin = await service.claimSeat(d.state.match.code, { seatKey: '2', name: 'Hal' });
    await service.submitMove(d.state.match.code, d.you.playerId, 'rock');
    await service.submitMove(d.state.match.code, dJoin.you.playerId, 'rock');
    await service.submitMove(d.state.match.code, d.you.playerId, 'paper');
    await service.submitMove(d.state.match.code, dJoin.you.playerId, 'scissors');

    // E: a match nobody played out. A win by disconnect is a fact about a network.
    const e = await service.createStandaloneMatch({
      gameMode: 'duel-helpers',
      hostName: 'Ivy',
      bestOf: 1,
      seats: [loadout('1', 'thief', 'bookend'), loadout('2', 'rust', 'poker-face')],
    });
    await service.claimSeat(e.state.match.code, { seatKey: '2', name: 'Jo' });
    await repo.endMatch(e.state.match.id, '1', 'forfeit-disconnect');

    // F: a capped draw. `bestOf: 1` caps the match at two rounds, and two mirrored
    // rounds reach it level — the one ending with no winning seat and both players
    // present for it.
    //
    // All four helpers are passive Minors that fire on a loss, a Lizard or a Robot,
    // so none of them touch a Rock or a Paper mirror. None is bound to Rock or Paper
    // either, and no seat brings two helpers bound to the *same* move — a collision
    // displaces the cheaper one's marks onto a clear move, and with this rng that
    // move is Rock. Both seats are `Minor+Minor`, a shape no other match here brings,
    // so this adds a row to `v_shape_win_rate` rather than moving the one already
    // there.
    const f = await service.createStandaloneMatch({
      gameMode: 'duel-helpers',
      hostName: 'Kit',
      bestOf: 1,
      seats: [loadout('1', 'tempered', 'well-oiled'), loadout('2', 'featherweight', 'grudge')],
    });
    const fJoin = await service.claimSeat(f.state.match.code, { seatKey: '2', name: 'Lou' });
    await service.submitMove(f.state.match.code, f.you.playerId, 'rock');
    await service.submitMove(f.state.match.code, fJoin.you.playerId, 'rock');
    // Rock carries two delay marks now, so the second mirror has to be a fresh move.
    await service.submitMove(f.state.match.code, f.you.playerId, 'paper');
    await service.submitMove(f.state.match.code, fJoin.you.playerId, 'paper');
  }, 30_000);

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.end();
  });

  it('mirrors the whole roster into the catalog', async () => {
    const row = await one('SELECT COUNT(*) AS n FROM helper_catalog');
    // Read off the roster rather than written out. The claim here is "the catalog
    // mirrors the whole roster", not "the roster has 25 cards" — a literal states
    // something the test does not mean, and since this file is `skipIf` a database
    // it passes locally and fails only in CI. That has cost four round-trips. The
    // deliberate pin lives in `roster.test.ts`, where changing it is the point.
    expect(num(row!.n)).toBe(HELPERS.length);
    const quarantine = await one("SELECT * FROM helper_catalog WHERE id = 'quarantine'");
    expect(quarantine).toMatchObject({ tier: 'Major', mark_cost: 2, bound_move: 'scissors' });
  });

  it('records both loadouts, the winner and the round count for every finished match', async () => {
    const all = await rows('SELECT * FROM v_match_telemetry ORDER BY created_at');
    expect(all).toHaveLength(6);
    expect(all.every((r) => r.seat_a_key === '1' && r.seat_b_key === '2')).toBe(true);

    const [a] = all;
    expect(a.seat_a_loadout).toEqual(['quarantine', 'copycat']);
    expect(a.seat_b_loadout).toEqual(['oracle', 'watchful']);
    expect(a.winner_seat_key).toBe('1');
    expect(num(a.rounds)).toBe(1);
    expect(a.end_reason).toBe('played');
  });

  it('names the shape of each loadout, dearer tier first', async () => {
    const a = await one("SELECT * FROM v_match_telemetry WHERE end_reason = 'played' ORDER BY created_at LIMIT 1");
    expect(a!.seat_a_shape).toBe('Major+Trinket');
    expect(a!.seat_b_shape).toBe('Major+Trinket');
  });

  it('puts `duel` on the same path as the null loadout, and counts its draws', async () => {
    const duel = await one("SELECT * FROM v_match_telemetry WHERE game_mode = 'duel'");
    expect(duel!.seat_a_loadout).toBeNull();
    expect(duel!.seat_a_shape).toBeNull();
    expect(num(duel!.rounds)).toBe(2);
    expect(num(duel!.draws)).toBe(1);
    expect(duel!.winner_seat_key).toBe('2');
  });

  it('flags a mirror rather than hiding it', async () => {
    const mirrors = await rows('SELECT * FROM v_match_telemetry WHERE is_mirror');
    expect(mirrors).toHaveLength(1);
    expect(mirrors[0].seat_a_loadout).toEqual(mirrors[0].seat_b_loadout);
  });

  it('counts a pick wherever it happened — popularity is not strength', async () => {
    const picks = await rows('SELECT * FROM v_helper_pick_rate');
    const byId = Object.fromEntries(picks.map((r) => [r.helper_id, r]));
    // Ten seat-loadouts were played (the `duel` match brings none). Quarantine is in
    // four of them, including both sides of the mirror and neither side of the
    // forfeit — which is only in three of those matches, so 4/10 is the check that
    // the mirror was counted here and the duel was not.
    expect(num(byId.quarantine.times_picked)).toBe(4);
    expect(num(byId.quarantine.pick_rate)).toBe(0.4);
    expect(num(byId.thief.times_picked)).toBe(1);
    // A card nobody brings is a balance finding, so it has to be in the view.
    expect(num(byId.chimera.times_picked)).toBe(0);
    expect(picks).toHaveLength(HELPERS.length);
  });

  it('drops mirrors and forfeits from win rate, and keeps everything else', async () => {
    const wins = await rows('SELECT * FROM v_helper_win_rate');
    const byId = Object.fromEntries(wins.map((r) => [r.helper_id, r]));
    // Two matches count: A and B. The mirror and the forfeit do not.
    expect(num(byId.quarantine.matches)).toBe(2);
    expect(num(byId.quarantine.wins)).toBe(2);
    expect(num(byId.quarantine.win_rate)).toBe(1);
    expect(num(byId.oracle.matches)).toBe(1);
    expect(num(byId.oracle.win_rate)).toBe(0);
    // Brought only into the forfeited match, so it has no balance data at all.
    expect(num(byId.thief.matches)).toBe(0);
    expect(byId.thief.win_rate).toBeNull();
  });

  it('rates a pairing as one loadout, whichever order it was picked in', async () => {
    const pairings = await rows('SELECT * FROM v_pairing_win_rate');
    const quarantineCopycat = pairings.find(
      (r) => r.helper_lo === 'copycat' && r.helper_hi === 'quarantine',
    );
    expect(num(quarantineCopycat!.matches)).toBe(2);
    expect(num(quarantineCopycat!.win_rate)).toBe(1);
    expect(quarantineCopycat!.shape).toBe('Major+Trinket');
    // The forfeited match's pairing is absent rather than a 0% one.
    expect(pairings.some((r) => r.helper_lo === 'bookend' && r.helper_hi === 'thief')).toBe(false);
  });

  it('sits a shape at 50% against itself, which is what the tier ladder predicts', async () => {
    const shapes = await rows('SELECT * FROM v_shape_win_rate');
    const major = shapes.find((r) => r.shape === 'Major+Trinket');
    expect(num(major!.matches)).toBe(4);
    expect(num(major!.win_rate)).toBe(0.5);
  });

  it('separates a named move that landed from one that did not', async () => {
    const firings = await rows('SELECT * FROM v_ability_firings ORDER BY target');
    expect(firings).toHaveLength(2);
    expect(firings.map((f) => [f.target, f.opponent_move, f.target_hit])).toEqual([
      ['paper', 'lizard', false],
      ['scissors', 'scissors', true],
    ]);
    expect(firings.every((f) => f.helper_id === 'quarantine' && f.round === 1)).toBe(true);
  });

  it('measures a charge against the matches it was brought into, not fired in', async () => {
    const usage = await rows('SELECT * FROM v_charge_usage');
    const byId = Object.fromEntries(usage.map((r) => [r.helper_id, r]));
    expect(num(byId.quarantine.matches_brought)).toBe(4);
    expect(num(byId.quarantine.matches_fired)).toBe(2);
    expect(num(byId.quarantine.firings)).toBe(2);
    expect(num(byId.quarantine.firings_per_match)).toBe(0.5);
    expect(num(byId.quarantine.avg_first_round)).toBe(1);
    // Brought, never fired — a Major slot spent on nothing, which is the number
    // this view exists to make visible.
    expect(num(byId.rust.matches_brought)).toBe(1);
    expect(num(byId.rust.matches_fired)).toBe(0);
    expect(byId.rust.avg_first_round).toBeNull();
    // Passives are not charges and have no business in here.
    expect(byId.copycat).toBeUndefined();
  });

  // --- JQ-255: the capped draw -----------------------------------------------

  it('keeps a capped draw in the balance data rather than filtering it out', async () => {
    const seats = await rows(`
      SELECT * FROM v_loadout_outcomes
      WHERE match_id = (SELECT match_id FROM v_match_telemetry WHERE end_reason = 'draw')
      ORDER BY seat_key
    `);
    expect(seats).toHaveLength(2);
    expect(seats.every((s) => s.counts_for_balance === true)).toBe(true);
    // Neither seat won it, and neither is pretended to have.
    expect(seats.every((s) => s.won === false)).toBe(true);
    expect(seats.every((s) => num(s.draws) === 2)).toBe(true);
  });

  it('rates a capped draw as neither a win nor a loss', async () => {
    const wins = await rows('SELECT * FROM v_helper_win_rate');
    const byId = Object.fromEntries(wins.map((r) => [r.helper_id, r]));
    // Tempered was brought into one match, and that match was drawn.
    expect(num(byId.tempered.matches)).toBe(1);
    expect(num(byId.tempered.drawn)).toBe(1);
    expect(num(byId.tempered.draw_rate)).toBe(1);
    // Nothing decisive to rate, so the win rate is absent — not 0, which would read
    // as a card that loses, and not 0.5, which would read as one that trades evenly.
    expect(num(byId.tempered.decisive)).toBe(0);
    expect(num(byId.tempered.wins)).toBe(0);
    expect(byId.tempered.win_rate).toBeNull();
    // And the decided matches are unmoved: a draw is on neither side of that ratio.
    expect(num(byId.quarantine.matches)).toBe(2);
    expect(num(byId.quarantine.decisive)).toBe(2);
    expect(num(byId.quarantine.win_rate)).toBe(1);
    expect(num(byId.quarantine.draw_rate)).toBe(0);
  });
});
