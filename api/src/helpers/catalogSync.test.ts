import { describe, expect, it } from 'vitest';
import { HELPERS, MARK_COST, isAbility } from './roster.js';
import { helperCatalogRows } from './catalogSync.js';

describe('helper catalog rows', () => {
  const rows = helperCatalogRows();

  it('is the roster, no card invented and none dropped', () => {
    expect(rows.map((r) => r.id).sort()).toEqual(HELPERS.map((h) => h.id).sort());
  });

  it('carries each card field for field', () => {
    for (const helper of HELPERS) {
      const row = rows.find((r) => r.id === helper.id);
      expect(row, `no catalog row for ${helper.id}`).toBeDefined();
      expect(row).toMatchObject({
        name: helper.name,
        tier: helper.tier,
        markCost: MARK_COST[helper.tier],
        boundMove: helper.boundMove,
        loadKind: helper.load.kind,
      });
    }
  });

  it('gives a charge its numbers and a passive none', () => {
    for (const helper of HELPERS) {
      const row = rows.find((r) => r.id === helper.id)!;
      if (isAbility(helper.load)) {
        expect(row.abilityOpening).toBe(helper.load.opening);
        expect(row.abilityRecharge).toBe(helper.load.recharge);
      } else {
        // A passive has no charge, so it has no numbers — not zeroes, which SQL
        // would happily average into a firing rate.
        expect(row.abilityOpening).toBeNull();
        expect(row.abilityRecharge).toBeNull();
      }
    }
  });

  it('leaves a Trinket without a bound move', () => {
    for (const row of rows.filter((r) => r.tier === 'Trinket')) {
      expect(row.boundMove).toBeNull();
      expect(row.markCost).toBe(0);
    }
  });
});
