import { describe, expect, it } from 'vitest';
import { ALL_MOVES, MOVE_META, describeOutcome, winsNeeded } from './moves';

describe('moves metadata', () => {
  it('has emoji + label for every move', () => {
    expect(ALL_MOVES).toEqual(['rock', 'paper', 'scissors', 'lizard', 'robot']);
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

describe('winsNeeded', () => {
  it('is first-to majority of bestOf', () => {
    expect(winsNeeded(1)).toBe(1);
    expect(winsNeeded(3)).toBe(2);
    expect(winsNeeded(5)).toBe(3);
    expect(winsNeeded(7)).toBe(4);
  });
});
