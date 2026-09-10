import { describe, expect, it } from 'vitest';
import { HELPERS, MARK_COST, firesInPublic, getHelper, isAbility } from './roster.js';

describe('helper roster', () => {
  it('holds 21 helpers at the current tier counts', () => {
    // Was 22 at 9/8/5. Blind Spot is cut, Second Wind promoted to Major, Poker Face
    // demoted to Trinket — see the review issue on the roster's pricing.
    expect(HELPERS).toHaveLength(21);
    const byTier = (t: string) => HELPERS.filter((h) => h.tier === t).length;
    expect(byTier('Major')).toBe(10);
    expect(byTier('Minor')).toBe(5);
    expect(byTier('Trinket')).toBe(6);
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

  /**
   * JQ-237 replaced "only a Major may carry a charge" with this. The Minor half of
   * the old rule is now a type fact rather than a roster fact — no shipping card is
   * a charged Minor yet — and lives in `rosterTyping.test.ts`.
   */
  it('keeps every Trinket passive, whatever the other tiers carry', () => {
    for (const h of HELPERS) {
      if (h.tier === 'Trinket') expect(h.load, h.id).toEqual({ kind: 'passive' });
    }
  });

  /**
   * AC #6: this ticket retiers nothing and recharges nothing. The ladder shape
   * table and the duel golden fixture both read these, so a card moved here without
   * meaning to shows up as a diff in this list rather than as a balance surprise.
   */
  it('leaves every shipping card on the tier and load it already had', () => {
    expect(HELPERS.map((h) => `${h.id}:${h.tier}:${h.load.kind}`)).toEqual([
      'good-old-rock:Major:passive',
      'chimera:Major:passive',
      'ferrus:Major:passive',
      'quarantine:Major:ability',
      'oracle:Major:ability',
      'sacrifice:Major:ability',
      'rust:Major:ability',
      'thief:Major:ability',
      'freeze:Major:ability',
      'second-wind:Major:passive',
      'echo-chamber:Minor:passive',
      'sharp-practice:Minor:passive',
      'grudge:Minor:passive',
      'tempered:Minor:passive',
      'featherweight:Minor:passive',
      'poker-face:Trinket:passive',
      'small-mercy:Trinket:passive',
      'copycat:Trinket:passive',
      'bookend:Trinket:passive',
      'old-habits:Trinket:passive',
      'watchful:Trinket:passive',
    ]);
  });

  it('gives every ability an opening and a recharge in delay marks', () => {
    const abilities = HELPERS.filter((h) => isAbility(h.load));
    expect(abilities.map((h) => h.id).sort()).toEqual([
      'freeze',
      'oracle',
      'quarantine',
      'rust',
      'sacrifice',
      'thief',
    ]);
    for (const h of abilities) {
      const load = h.load;
      if (!isAbility(load)) throw new Error('filtered above');
      expect(load.opening, h.id).toBeGreaterThanOrEqual(0);
      // A recharge of 0 would be "every round", which is what Quarantine was
      // repriced away from; null is the deliberate "once per match".
      if (load.recharge !== null) expect(load.recharge, h.id).toBeGreaterThan(0);
    }
  });

  it('starts every ability uniform except the one deliberate exception', () => {
    // Uniform on purpose: the first telemetry read should vary one thing at a time.
    // Sacrifice is gated late because its early line is degenerate, not just weak.
    const marks = Object.fromEntries(
      HELPERS.filter((h) => isAbility(h.load)).map((h) => {
        const load = h.load;
        if (!isAbility(load)) throw new Error('filtered above');
        return [h.id, `${load.opening}/${load.recharge}`];
      }),
    );
    expect(marks).toEqual({
      quarantine: '0/3',
      oracle: '0/3',
      rust: '0/3',
      thief: '0/3',
      freeze: '0/3',
      sacrifice: '3/3',
    });
  });

  it('says of every ability whether it fires in secret or in public', () => {
    for (const h of HELPERS) {
      if (isAbility(h.load)) expect(h.reveal, h.id).toMatch(/^(secret|public)$/);
      // A passive has no firing to disclose, so it declares nothing. The type
      // already refuses one that tries; this is the runtime half of that rule.
      else expect(h.reveal, h.id).toBeUndefined();
    }
  });

  it('classifies all six abilities secret, so no card changes behaviour yet', () => {
    // Making one public is a balance decision per card, deliberately not taken
    // here — see JQ-235's non-goals. When one is, this test is the one to move.
    const abilities = HELPERS.filter((h) => isAbility(h.load));
    expect(abilities.map((h) => h.reveal)).toEqual(abilities.map(() => 'secret'));
    expect(HELPERS.filter((h) => firesInPublic(h.id))).toEqual([]);
  });

  it('makes the blurb agree with the field, so card text cannot lie about it', () => {
    // The whole reason the distinction is a field: a blurb saying "secretly" while
    // the code discloses the firing is worse than either, and nothing but this test
    // stands between the two.
    for (const h of HELPERS) {
      if (!isAbility(h.load)) continue;
      expect(/secretly/i.test(h.blurb), `${h.id}: ${h.blurb}`).toBe(h.reveal === 'secret');
    }
  });

  it('calls a passive neither secret nor public, since it never fires', () => {
    for (const h of HELPERS) {
      if (isAbility(h.load)) continue;
      expect(firesInPublic(h.id), h.id).toBe(false);
      expect(/secretly/i.test(h.blurb), h.id).toBe(false);
    }
  });

  it('withholds rather than discloses an id it cannot place', () => {
    expect(firesInPublic('nonesuch')).toBe(false);
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
