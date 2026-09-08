import { describe, expect, it } from 'vitest';
import { HELPERS, MARK_COST, getHelper } from './roster.js';

describe('helper roster', () => {
  it('holds all 22 helpers at the design doc tier counts', () => {
    expect(HELPERS).toHaveLength(22);
    const byTier = (t: string) => HELPERS.filter((h) => h.tier === t).length;
    expect(byTier('Major')).toBe(9);
    expect(byTier('Minor')).toBe(8);
    expect(byTier('Trinket')).toBe(5);
  });

  it('prices tiers as the ladder requires', () => {
    expect(MARK_COST).toEqual({ Major: 2, Minor: 1, Trinket: 0 });
  });

  it('binds every Major and Minor to a move, and no Trinket', () => {
    for (const h of HELPERS) {
      if (h.tier === 'Trinket') expect(h.boundMove, h.id).toBeNull();
      else expect(h.boundMove, h.id).not.toBeNull();
    }
  });

  it('gives only Majors a non-passive load', () => {
    for (const h of HELPERS) {
      if (h.tier !== 'Major') expect(h.load, h.id).toBe('passive');
    }
  });

  it('looks a helper up by id', () => {
    expect(getHelper('ferrus')?.name).toBe('Ferrus');
    expect(getHelper('nonesuch')).toBeUndefined();
  });

  it('gives every helper a distinct kebab-case id', () => {
    const ids = HELPERS.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, id).toMatch(/^[a-z][a-z-]*[a-z]$/);
  });

  it('gives every helper player-facing copy', () => {
    for (const h of HELPERS) {
      expect(h.name, h.id).not.toBe('');
      expect(h.blurb.endsWith('.'), h.id).toBe(true);
    }
  });
});
