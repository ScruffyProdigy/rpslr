import { describe, expect, it } from 'vitest';
import { HELPERS, MARK_COST, firesInPublic, isAbility } from './roster.js';
import { informsItsHolder } from './reveals.js';
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

  /**
   * JQ-262 counts a match's mid-round pauses in SQL, and the two facts that decide
   * whether a firing opens one live in TypeScript. If they stop being mirrored the
   * views do not fail — they quietly undercount, which is the worst outcome for a
   * number someone is about to make a pacing decision on.
   */
  it('carries both halves of "does firing this open a sub-phase"', () => {
    for (const helper of HELPERS) {
      const row = rows.find((r) => r.id === helper.id)!;
      // The two axes are genuinely independent: Oracle is secret and still opens a
      // window, because it reveals to the seat that fired it.
      expect(row.informsItsHolder).toBe(informsItsHolder(helper.id));
      if (isAbility(helper.load)) {
        expect(row.reveal).toBe(helper.reveal);
        expect(row.reveal === 'public').toBe(firesInPublic(helper.id));
      } else {
        // A passive has no firing to disclose, so it withholds nothing — null
        // rather than 'secret', which would claim it was keeping something back.
        expect(row.reveal).toBeNull();
        expect(row.informsItsHolder).toBe(false);
      }
    }
  });

  it('agrees with the roster on which cards can open a sub-phase at all', () => {
    // Pinned as a list rather than a count: this is the roster's entire pacing
    // budget, and a card joining it should be a deliberate edit here.
    const openers = rows
      .filter((r) => r.informsItsHolder || r.reveal === 'public')
      .map((r) => r.id)
      .sort();
    expect(openers).toEqual(['freeze', 'oracle', 'quarantine']);
  });

  it('leaves a Trinket without a bound move', () => {
    for (const row of rows.filter((r) => r.tier === 'Trinket')) {
      expect(row.boundMove).toBeNull();
      expect(row.markCost).toBe(0);
    }
  });
});
