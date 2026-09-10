import { describe, expect, it } from 'vitest';
import { openingMarks, parseLoadout, uniformPicker } from './loadout.js';
import type { Move } from '../game.js';

describe('parseLoadout', () => {
  it('accepts any two distinct helpers, in any tier combination', () => {
    expect(parseLoadout(['ferrus', 'chimera'])).toEqual(['ferrus', 'chimera']);
    expect(parseLoadout(['copycat', 'watchful'])).toEqual(['copycat', 'watchful']);
    expect(parseLoadout(['oracle', 'good-old-rock'])).toEqual(['oracle', 'good-old-rock']);
    expect(parseLoadout(['tripwire', 'grudge'])).toEqual(['tripwire', 'grudge']);
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

describe('openingMarks', () => {
  /** Deterministic stand-in for the uniform roll. */
  const first = (c: Move[]) => c[0];

  it('reproduces the duel opening for Ferrus + Featherweight', () => {
    const { delays, rolledMove } = openingMarks(['ferrus', 'featherweight'], first);
    expect(delays).toEqual({ rock: 0, paper: 0, scissors: 0, lizard: 1, robot: 2 });
    expect(rolledMove).toBeNull();
  });

  it('leaves four live for a Major + Trinket', () => {
    const { delays } = openingMarks(['ferrus', 'copycat'], first);
    expect(delays).toEqual({ rock: 0, paper: 0, scissors: 0, lizard: 0, robot: 2 });
  });

  it('leaves all five live for two Trinkets', () => {
    const { delays, rolledMove } = openingMarks(['copycat', 'watchful'], first);
    expect(delays).toEqual({ rock: 0, paper: 0, scissors: 0, lizard: 0, robot: 0 });
    expect(rolledMove).toBeNull();
  });

  it('blocks two moves at 2 marks each for two Majors', () => {
    const { delays } = openingMarks(['ferrus', 'chimera'], first);
    expect(delays).toEqual({ rock: 0, paper: 0, scissors: 0, lizard: 2, robot: 2 });
  });

  it('rolls the cheaper helper elsewhere when both bind the same move', () => {
    // oracle (Major, paper, 2) + echo-chamber (Minor, paper, 1).
    // The Minor is cheaper, so its 1 mark rolls onto a move that is not paper.
    const { delays, rolledMove } = openingMarks(['oracle', 'echo-chamber'], first);
    expect(delays.paper).toBe(2);
    expect(rolledMove).not.toBeNull();
    expect(rolledMove).not.toBe('paper');
    expect(delays[rolledMove as Move]).toBe(1);
    expect(Object.values(delays).filter((n) => n > 0)).toHaveLength(2);
  });

  it('displaces the cheaper helper whichever order it was picked in', () => {
    const { delays } = openingMarks(['echo-chamber', 'oracle'], first);
    expect(delays.paper).toBe(2);
    expect(Object.values(delays).filter((n) => n > 0)).toHaveLength(2);
  });

  it('gives the roll to the second helper when two Majors share a move', () => {
    // good-old-rock and sacrifice are both Rock-bound Majors, so the tie keeps the
    // first pick in place and the second one's full 2 marks are displaced. (This
    // used to pair Good Old Rock with Second Wind, which JQ-236 retired.)
    const { delays, rolledMove } = openingMarks(['good-old-rock', 'sacrifice'], first);
    expect(delays.rock).toBe(2);
    expect(rolledMove).not.toBe('rock');
    expect(delays[rolledMove as Move]).toBe(2);
    expect(Object.values(delays).filter((n) => n > 0)).toHaveLength(2);
  });

  it('gives the roll to the second helper picked when the tiers tie', () => {
    // grudge and sharp-practice are both Minors bound to scissors.
    const { delays, rolledMove } = openingMarks(['grudge', 'sharp-practice'], first);
    expect(delays.scissors).toBe(1);
    expect(rolledMove).not.toBe('scissors');
    expect(delays[rolledMove as Move]).toBe(1);
  });

  it('never rolls onto an already-blocked move', () => {
    const candidatesSeen: Move[][] = [];
    openingMarks(['good-old-rock', 'sacrifice'], (c) => {
      candidatesSeen.push(c);
      return c[0];
    });
    expect(candidatesSeen).toHaveLength(1);
    expect(candidatesSeen[0]).not.toContain('rock');
    expect(candidatesSeen[0]).toHaveLength(4);
  });

  it('does not roll when a Trinket shares nothing to collide with', () => {
    const picks: Move[][] = [];
    openingMarks(['copycat', 'bookend'], (c) => {
      picks.push(c);
      return c[0];
    });
    expect(picks).toHaveLength(0);
  });

  it('spends the loadout price and no more, collision or not', () => {
    const total = (d: Record<Move, number>) => Object.values(d).reduce((n, m) => n + m, 0);
    expect(total(openingMarks(['good-old-rock', 'sacrifice'], first).delays)).toBe(4);
    expect(total(openingMarks(['tempered', 'featherweight'], first).delays)).toBe(2);
    expect(total(openingMarks(['ferrus', 'grudge'], first).delays)).toBe(3);
    expect(total(openingMarks(['ferrus', 'poker-face'], first).delays)).toBe(2);
  });
});

describe('uniformPicker', () => {
  it('spreads over every candidate and never leaves the list', () => {
    const seen = new Set<Move>();
    for (let i = 0; i < 4; i += 1) {
      const pick = uniformPicker(() => i / 4);
      seen.add(pick(['paper', 'scissors', 'lizard', 'robot']));
    }
    expect([...seen].sort()).toEqual(['lizard', 'paper', 'robot', 'scissors']);
  });

  it('stays in range when the rng returns its extremes', () => {
    expect(uniformPicker(() => 0)(['paper', 'scissors'])).toBe('paper');
    expect(uniformPicker(() => 0.999999)(['paper', 'scissors'])).toBe('scissors');
  });
});
