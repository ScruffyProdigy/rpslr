import { describe, expect, it } from 'vitest';
import { MOVES } from '../game.js';
import { HELPERS, MARK_COST, firesInPublic, getHelper, isAbility } from './roster.js';

describe('helper roster', () => {
  it('holds 22 helpers at the current tier counts', () => {
    // 21 at 10/5/6 before JQ-209's pricing pass. Small Mercy moved up to Minor (one
    // mark of denial is ~7.3pp, Minor money) and Well Oiled was added, which is what
    // gave Rock and Robot the Minors they had none of.
    expect(HELPERS).toHaveLength(22);
    const byTier = (t: string) => HELPERS.filter((h) => h.tier === t).length;
    expect(byTier('Major')).toBe(10);
    expect(byTier('Minor')).toBe(7);
    expect(byTier('Trinket')).toBe(5);
  });

  /**
   * JQ-209's variety half. A tier with no card on a move means a player who wants
   * that move cannot buy in at that price — Rock had three Majors and no Minor, so
   * there was no way to place a single opening mark there, and Robot had the same
   * hole. This is the assertion that keeps it closed as cards move.
   */
  it('offers both a Major and a Minor on every move', () => {
    for (const move of MOVES) {
      const on = (t: string) => HELPERS.filter((h) => h.tier === t && h.boundMove === move);
      expect(on('Major').length, `${move} Majors`).toBeGreaterThan(0);
      expect(on('Minor').length, `${move} Minors`).toBeGreaterThan(0);
    }
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
   * JQ-237 added this to prove its own ticket retiered and recharged nothing. It is
   * kept, and moved, because it does the same job for JQ-209 in the other
   * direction: this pass *does* retier, so the list below is the reviewable record
   * of exactly which cards moved and which did not.
   *
   * The ladder shape table and the duel golden fixture both read these, so a card
   * moved without meaning to still shows up as a diff here rather than as a balance
   * surprise. Since JQ-209: Small Mercy is a Minor bound to Rock, Well Oiled is new
   * on Robot, and nothing else changed tier.
   */
  it('leaves every shipping card on the tier and load JQ-209 priced it at', () => {
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
      'small-mercy:Minor:passive',
      'well-oiled:Minor:passive',
      'poker-face:Trinket:passive',
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

  it('prices each ability at the cadence its effect is worth', () => {
    // These were uniform at 0/3 so the first telemetry read would vary one thing at
    // a time. JQ-209 broke that deliberately: uniformity is only informative over a
    // roster that is roughly correct, and Rust and Freeze were at ~26pp against a
    // 9-10pp target — 2.5x, the same margin Quarantine was repriced away from. A
    // known 3x error makes telemetry less readable than a mixed cadence does.
    //
    // Openings are still untouched, so pacing remains the one uniform axis. Sacrifice
    // is the lone gate, because its early line is degenerate rather than merely weak.
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
      // +1 mark on a 4-mark recharge is ~9.6pp; it was +2 on 3, which is ~26pp.
      rust: '0/4',
      // Denies and relieves in one action, so it carries the longest recurring gap.
      thief: '0/6',
      // `recharge: null` is once per match — the value the type always had and
      // nothing used until Freeze needed it.
      freeze: '0/null',
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

  it('fires Freeze in public and the rest in secret', () => {
    // JQ-235 built the field and left every card secret, calling the first public
    // card a per-card balance decision. JQ-209 took it for Freeze: the card is worth
    // ~2 marks a firing whoever can see it, so cutting the effect would have made it
    // Rust without a target. Being announced before anyone commits is what prices it
    // instead, and it costs no sub-phase — the pick phase is already the window.
    //
    // Quarantine and Sacrifice cannot follow it: both are secret out of necessity,
    // since a named move that can be dodged collects nothing and a declared draw the
    // opponent can see is not a wasted move. Rust and Thief could, and have not been.
    const publicIds = HELPERS.filter((h) => firesInPublic(h.id)).map((h) => h.id);
    expect(publicIds).toEqual(['freeze']);
    for (const h of HELPERS.filter((h) => isAbility(h.load) && h.id !== 'freeze')) {
      expect(h.reveal, h.id).toBe('secret');
    }
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
