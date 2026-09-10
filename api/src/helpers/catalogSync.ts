/**
 * The roster, pushed into SQL.
 *
 * JQ-152's telemetry views are pure derivations of rows the match path already
 * writes, with one exception: a helper's tier. That lives in `roster.ts` and SQL
 * cannot read TypeScript, so the roster is mirrored into `helper_catalog`.
 *
 * It is synced rather than seeded by the migration on purpose. A seed migration
 * would make every pricing change (JQ-209 has one queued) a new migration whose
 * only job is to correct the last one, and a catalog that drifts from the roster
 * mislabels a shape without failing anything. Syncing makes the roster the single
 * source of truth and the drift impossible: the sync runs at the end of
 * `npm run migrate` and again when the API boots.
 */

import type { Pool } from 'pg';
import { HELPERS, MARK_COST, isAbility } from './roster.js';
import { informsItsHolder } from './reveals.js';

export interface HelperCatalogRow {
  id: string;
  name: string;
  tier: string;
  /** Opening marks the tier costs; SQL orders a pairing's shape by it. */
  markCost: number;
  boundMove: string | null;
  loadKind: 'passive' | 'ability';
  /** Null for a passive — not 0, which SQL would average into a firing rate. */
  abilityOpening: number | null;
  /** Null for a passive, and for a charge that never comes back. */
  abilityRecharge: number | null;
  /**
   * Whether the firing is announced as it happens. Null for a passive, which has
   * no firing to disclose — not 'secret', which would claim a passive is keeping
   * something back.
   */
  reveal: 'public' | 'secret' | null;
  /**
   * Whether firing it tells its own holder something. A separate axis from
   * `reveal`: Oracle is secret and still opens a sub-phase, because it reveals to
   * the seat that fired it. JQ-262 needs both to count a pause's cause.
   */
  informsItsHolder: boolean;
}

export function helperCatalogRows(): HelperCatalogRow[] {
  return HELPERS.map((helper) => ({
    id: helper.id,
    name: helper.name,
    tier: helper.tier,
    markCost: MARK_COST[helper.tier],
    boundMove: helper.boundMove,
    loadKind: helper.load.kind,
    abilityOpening: isAbility(helper.load) ? helper.load.opening : null,
    abilityRecharge: isAbility(helper.load) ? helper.load.recharge : null,
    reveal: helper.reveal ?? null,
    informsItsHolder: informsItsHolder(helper.id),
  }));
}

export interface CatalogSyncResult {
  upserted: number;
  removed: number;
}

/**
 * Make `helper_catalog` match the roster exactly. Idempotent, 21 rows, safe to run
 * on every boot.
 *
 * The delete is the half that matters: a card cut from the roster (Blind Spot was)
 * would otherwise keep answering shape lookups for loadouts nobody can bring.
 */
export async function syncHelperCatalog(pool: Pool): Promise<CatalogSyncResult> {
  const rows = helperCatalogRows();
  const ids = rows.map((r) => r.id);

  const upsert = await pool.query(
    `INSERT INTO helper_catalog
       (id, name, tier, mark_cost, bound_move, load_kind, ability_opening, ability_recharge,
        reveal, informs_its_holder, synced_at)
     SELECT * FROM UNNEST(
       $1::text[], $2::text[], $3::text[], $4::int[], $5::text[], $6::text[], $7::int[], $8::int[],
       $9::text[], $10::boolean[]
     ) AS t(id, name, tier, mark_cost, bound_move, load_kind, ability_opening, ability_recharge,
            reveal, informs_its_holder),
     LATERAL (SELECT now()) AS n(synced_at)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       tier = EXCLUDED.tier,
       mark_cost = EXCLUDED.mark_cost,
       bound_move = EXCLUDED.bound_move,
       load_kind = EXCLUDED.load_kind,
       ability_opening = EXCLUDED.ability_opening,
       ability_recharge = EXCLUDED.ability_recharge,
       reveal = EXCLUDED.reveal,
       informs_its_holder = EXCLUDED.informs_its_holder,
       synced_at = now()`,
    [
      ids,
      rows.map((r) => r.name),
      rows.map((r) => r.tier),
      rows.map((r) => r.markCost),
      rows.map((r) => r.boundMove),
      rows.map((r) => r.loadKind),
      rows.map((r) => r.abilityOpening),
      rows.map((r) => r.abilityRecharge),
      rows.map((r) => r.reveal),
      rows.map((r) => r.informsItsHolder),
    ],
  );

  const removed = await pool.query('DELETE FROM helper_catalog WHERE id <> ALL($1::text[])', [ids]);

  return { upserted: upsert.rowCount ?? 0, removed: removed.rowCount ?? 0 };
}
