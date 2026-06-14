import { describe, expect, it } from 'vitest';
import {
  ALL_MOVES,
  MOVE_META,
  describeBeat,
  describeOutcome,
  describeRoundMatchup,
  winsNeeded,
} from './moves';

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

describe('describeBeat', () => {
  it('uses official verb phrasing', () => {
    expect(describeBeat('paper', 'robot')).toBe('Paper disproves Robot');
    expect(describeBeat('rock', 'scissors')).toBe('Rock crushes Scissors');
    expect(describeBeat('robot', 'rock')).toBe('Robot vaporizes Rock');
  });
});

describe('describeRoundMatchup', () => {
  it('describes draws and wins from the viewer perspective', () => {
    expect(describeRoundMatchup('paper', 'robot')).toBe('Paper disproves Robot');
    expect(describeRoundMatchup('robot', 'paper')).toBe('Paper disproves Robot');
    expect(describeRoundMatchup('rock', 'rock')).toBe('Rock vs Rock — same pick, no winner');
  });
});
