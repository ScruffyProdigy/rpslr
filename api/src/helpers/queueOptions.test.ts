import { describe, expect, it } from 'vitest';
import { prequeueFixture, serialize } from '../fixtures.testutil.js';
import { getGameMode } from '../gameModes.js';
import { badgeForTier, helperChoices, validateSelection } from './queueOptions.js';
import { HELPERS, MARK_COST } from './roster.js';

const HELPERS_GROUP = getGameMode('duel-helpers')!.preQueue!.groups[0];

describe('helper roster for queue-options', () => {
  it('matches the contract fixture field for field, in order', () => {
    expect(serialize({ modeKey: 'duel-helpers', choices: helperChoices() })).toBe(
      serialize(prequeueFixture('queue-options.duel-helpers')),
    );
  });

  it('serves all 21 helpers', () => {
    expect(helperChoices()).toHaveLength(21);
    expect(helperChoices()).toHaveLength(HELPERS.length);
  });

  it('is generated from roster.ts, so a card added there reaches the picker', () => {
    expect(helperChoices().map((c) => c.id)).toEqual(HELPERS.map((h) => h.id));
    expect(helperChoices().map((c) => c.description)).toEqual(HELPERS.map((h) => h.blurb));
  });

  it('locks nothing — no progression, so every player sees the same roster', () => {
    expect(helperChoices().every((c) => c.locked === false)).toBe(true);
  });

  /**
   * JQ-237. Zero-load stopped being a tier guarantee the moment a Minor could
   * carry a charge: "no Major" used to mean "nothing to remember to use", and a new
   * player picking Minor + Minor for simplicity can now land on two abilities by
   * accident. The picker can only warn them if the payload says so, which is why
   * this is a requirement of that change and not a nicety.
   */
  it('says of every card whether it carries a charge, and on what clock', () => {
    const byId = new Map(helperChoices().map((c) => [c.id, c.load]));
    expect(byId.get('ferrus')).toEqual({ kind: 'passive' });
    expect(byId.get('quarantine')).toEqual({ kind: 'ability', opening: 0, recharge: 3 });
    // Sacrifice is the card the numbers exist for: it does nothing until round 4,
    // and a player drafting it blind has no way to know that from the blurb.
    expect(byId.get('sacrifice')).toEqual({ kind: 'ability', opening: 3, recharge: 3 });
  });

  it('takes the load from roster.ts rather than restating it', () => {
    expect(helperChoices().map((c) => c.load)).toEqual(HELPERS.map((h) => h.load));
  });

  it('derives the badge from MARK_COST, and calls a free card free rather than "0 marks"', () => {
    expect(badgeForTier('Major')).toBe(`${MARK_COST.Major} marks`);
    expect(badgeForTier('Minor')).toBe('1 mark');
    expect(badgeForTier('Trinket')).toBe('Free');
  });
});

describe('validateSelection', () => {
  it('accepts two distinct helpers', () => {
    expect(validateSelection(HELPERS_GROUP, ['ferrus', 'chimera'])).toEqual(['ferrus', 'chimera']);
  });

  it('rejects a selection that is short of the group minimum', () => {
    expect(validateSelection(HELPERS_GROUP, ['ferrus'])).toContain('exactly 2 helpers');
  });

  it('rejects a selection over the group maximum', () => {
    expect(validateSelection(HELPERS_GROUP, ['oracle', 'copycat', 'watchful'])).toContain(
      'exactly 2 helpers',
    );
  });

  it('rejects the same helper twice, though two helpers on the same move are legal', () => {
    expect(validateSelection(HELPERS_GROUP, ['ferrus', 'ferrus'])).toContain(
      'two different helpers',
    );
    // Ferrus and Freeze are both Robot-bound: a legal pairing the engine displaces.
    expect(validateSelection(HELPERS_GROUP, ['ferrus', 'freeze'])).toEqual(['ferrus', 'freeze']);
  });

  it('rejects an id that is not on the roster this game serves', () => {
    expect(validateSelection(HELPERS_GROUP, ['ferrus', 'nonesuch'])).toBe(
      'unknown helper: nonesuch',
    );
  });

  it('reports arity before membership, so a short selection is not blamed on an id', () => {
    expect(validateSelection(HELPERS_GROUP, ['nonesuch'])).toContain('exactly 2 helpers');
  });

  it('refuses a group whose kind has no roster behind it', () => {
    const unknown = { ...HELPERS_GROUP, kind: 'Champion' };
    expect(validateSelection(unknown, ['anything'])).toContain('unknown pre-queue group kind');
  });

  it('phrases arity as a range when a group allows one', () => {
    const range = { ...HELPERS_GROUP, min: 1, max: 3 };
    expect(validateSelection(range, [])).toContain('between 1 and 3 helpers');
    expect(validateSelection(range, ['ferrus'])).toEqual(['ferrus']);
  });
});
