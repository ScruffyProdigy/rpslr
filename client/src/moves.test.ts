import { describe, expect, it } from 'vitest';
import { ALL_MOVES, MOVE_META, describeOutcome } from './moves';

describe('moves metadata', () => {
  it('has emoji + label for every move', () => {
    expect(ALL_MOVES).toEqual(['rock', 'paper', 'scissors', 'lizard', 'spock']);
    for (const m of ALL_MOVES) {
      expect(MOVE_META[m].emoji).toBeTruthy();
      expect(MOVE_META[m].label).toBeTruthy();
    }
  });
});

describe('describeOutcome', () => {
  it('maps outcomes relative to the viewer seat', () => {
    expect(describeOutcome('a', 'a')).toBe('win');
    expect(describeOutcome('b', 'a')).toBe('loss');
    expect(describeOutcome('a', 'b')).toBe('loss');
    expect(describeOutcome('b', 'b')).toBe('win');
    expect(describeOutcome('draw', 'a')).toBe('draw');
  });
});
