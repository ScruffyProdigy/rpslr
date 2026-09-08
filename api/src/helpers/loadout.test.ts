import { describe, expect, it } from 'vitest';
import { parseLoadout } from './loadout.js';

describe('parseLoadout', () => {
  it('accepts any two distinct helpers, in any tier combination', () => {
    expect(parseLoadout(['ferrus', 'chimera'])).toEqual(['ferrus', 'chimera']);
    expect(parseLoadout(['copycat', 'watchful'])).toEqual(['copycat', 'watchful']);
    expect(parseLoadout(['oracle', 'good-old-rock'])).toEqual(['oracle', 'good-old-rock']);
    expect(parseLoadout(['second-wind', 'grudge'])).toEqual(['second-wind', 'grudge']);
  });

  it('keeps the order it was given, because the tie rule depends on it', () => {
    expect(parseLoadout(['grudge', 'sharp-practice'])).toEqual(['grudge', 'sharp-practice']);
    expect(parseLoadout(['sharp-practice', 'grudge'])).toEqual(['sharp-practice', 'grudge']);
  });

  it('rejects the same helper twice rather than coercing it', () => {
    expect(parseLoadout(['ferrus', 'ferrus'])).toBe('a loadout needs two different helpers');
  });

  it('rejects the wrong number of helpers', () => {
    expect(parseLoadout(['ferrus'])).toBe('a loadout needs exactly 2 helpers');
    expect(parseLoadout(['ferrus', 'chimera', 'copycat'])).toBe(
      'a loadout needs exactly 2 helpers',
    );
    expect(parseLoadout([])).toBe('a loadout needs exactly 2 helpers');
  });

  it('rejects an unknown helper by name', () => {
    expect(parseLoadout(['ferrus', 'nonesuch'])).toBe('unknown helper: nonesuch');
  });

  it('rejects a non-array', () => {
    expect(parseLoadout(undefined)).toBe('a loadout needs exactly 2 helpers');
    expect(parseLoadout(null)).toBe('a loadout needs exactly 2 helpers');
    expect(parseLoadout('ferrus,chimera')).toBe('a loadout needs exactly 2 helpers');
    expect(parseLoadout({ 0: 'ferrus', 1: 'chimera' })).toBe(
      'a loadout needs exactly 2 helpers',
    );
  });

  it('rejects a non-string entry rather than stringifying it', () => {
    expect(parseLoadout(['ferrus', 7])).toBe('a loadout needs exactly 2 helpers');
    expect(parseLoadout(['ferrus', null])).toBe('a loadout needs exactly 2 helpers');
    expect(parseLoadout(['ferrus', '  '])).toBe('a loadout needs exactly 2 helpers');
  });

  it('trims surrounding whitespace before matching', () => {
    expect(parseLoadout([' ferrus', 'chimera '])).toEqual(['ferrus', 'chimera']);
  });

  it('rejects a duplicate that differs only by whitespace', () => {
    expect(parseLoadout(['ferrus', ' ferrus '])).toBe('a loadout needs two different helpers');
  });
});
