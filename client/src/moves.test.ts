import { describe, expect, it } from 'vitest';
import {
  ALL_MOVES,
  MOVE_META,
  describeBeat,
  describeOutcome,
  describeBeatsOf,
  describeRoundMatchup,
  beatsOf,
  opponentCooldownPhrase,
  threatsTo,
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

describe('beatsOf', () => {
  it('lists the two moves each move beats, in rules-copy order', () => {
    expect(beatsOf('rock')).toEqual(['scissors', 'lizard']);
    expect(beatsOf('paper')).toEqual(['rock', 'robot']);
    expect(beatsOf('scissors')).toEqual(['paper', 'lizard']);
    expect(beatsOf('lizard')).toEqual(['paper', 'robot']);
    expect(beatsOf('robot')).toEqual(['scissors', 'rock']);
  });

  it('covers every move exactly twice across the graph', () => {
    const beaten = ALL_MOVES.flatMap(beatsOf);
    for (const m of ALL_MOVES) {
      expect(beaten.filter((x) => x === m)).toHaveLength(2);
    }
  });
});

describe('describeBeatsOf', () => {
  it('collapses a shared verb and keeps distinct ones', () => {
    expect(describeBeatsOf('rock')).toBe('Rock crushes Scissors & Lizard');
    expect(describeBeatsOf('paper')).toBe('Paper covers Rock & disproves Robot');
    expect(describeBeatsOf('scissors')).toBe('Scissors cuts Paper & decapitates Lizard');
    expect(describeBeatsOf('lizard')).toBe('Lizard eats Paper & poisons Robot');
    expect(describeBeatsOf('robot')).toBe('Robot smashes Scissors & vaporizes Rock');
  });
});

describe('threatsTo', () => {
  it('lists the two moves that beat it, regardless of cooldown', () => {
    expect(threatsTo('rock', {}).all).toEqual(['paper', 'robot']);
    expect(threatsTo('robot', {}).all).toEqual(['paper', 'lizard']);
  });

  it('drops threats the opponent cannot play this round', () => {
    const t = threatsTo('rock', { robot: 2 });
    expect(t.live).toEqual(['paper']);
    expect(t.safe).toBe(false);
  });

  it('is safe only when every threat is on the opponent cooldown', () => {
    expect(threatsTo('rock', { paper: 1, robot: 2 }).safe).toBe(true);
    expect(threatsTo('rock', { paper: 0, robot: 2 }).safe).toBe(false);
    expect(threatsTo('rock', {}).safe).toBe(false);
  });

  it('treats a missing delay entry as playable', () => {
    expect(threatsTo('lizard', { rock: 2 }).live).toEqual(['scissors']);
  });
});

describe('opponentCooldownPhrase', () => {
  it('names the move and the wait', () => {
    expect(opponentCooldownPhrase('robot', 2)).toBe("Opponent can't play Robot for 2 turns");
    expect(opponentCooldownPhrase('lizard', 1)).toBe("Opponent can't play Lizard for 1 turn");
  });
});
