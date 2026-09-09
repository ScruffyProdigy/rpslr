import { describe, expect, it } from 'vitest';
import type { DelayMap } from '@game/game';
import {
  ALL_MOVES,
  MOVE_META,
  describeBeat,
  describeOutcome,
  describeBeatsOf,
  describeBeatsGraph,
  describeRoundMatchup,
  beatsOf,
  opponentCooldownPhrase,
  cooldownCause,
  threatsTo,
  winningEdgeOf,
  winsNeeded,
  isPlayable,
  isForcedPick,
} from './moves';

describe('moves metadata', () => {
  it('has a label for every move', () => {
    expect(ALL_MOVES).toEqual(['rock', 'paper', 'scissors', 'lizard', 'robot']);
    for (const m of ALL_MOVES) {
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


describe('winningEdgeOf', () => {
  it('points from the winning move to the losing one', () => {
    expect(winningEdgeOf('rock', 'scissors')).toEqual({ from: 'rock', to: 'scissors', role: 'you' });
  });

  // The edge is the graph's, not the viewer's — only `role` flips.
  it('marks the edge as the opponent’s when they win', () => {
    expect(winningEdgeOf('scissors', 'rock')).toEqual({ from: 'rock', to: 'scissors', role: 'opp' });
  });

  it('has no edge for a mirror match', () => {
    expect(winningEdgeOf('lizard', 'lizard')).toBeNull();
  });

  it('agrees with beatsOf for every ordered pair', () => {
    for (const a of ALL_MOVES) {
      for (const b of ALL_MOVES) {
        const edge = winningEdgeOf(a, b);
        if (a === b) {
          expect(edge).toBeNull();
        } else {
          expect(beatsOf(edge!.from)).toContain(edge!.to);
        }
      }
    }
  });
});


describe('cooldownCause', () => {
  /** What a duel opens on. A loadout opens on something else. */
  const duel: DelayMap = { rock: 0, paper: 0, scissors: 0, lizard: 1, robot: 2 };

  it('blames your last round when that is where it came from', () => {
    expect(cooldownCause('rock', ['rock', 'paper'], duel)).toBe('You played Rock last round');
  });

  it('reaches back a second round', () => {
    expect(cooldownCause('paper', ['rock', 'paper'], duel)).toBe('You played Paper two rounds ago');
  });

  // Round 1: nothing has been played, so Lizard and Robot are down by the rules.
  it('falls back to the opening when you have not played it', () => {
    expect(cooldownCause('robot', [], duel)).toBe('Robot starts the match on cooldown');
    expect(cooldownCause('robot', ['rock'], duel)).toBe('Robot starts the match on cooldown');
  });

  it('does not blame an opening this match never had', () => {
    // Scissors is clear at the start of a Grudge + Copycat loadout, so a mark on
    // it came from somewhere else — an opponent's card, most likely. Naming the
    // opening would be a confident answer to a question this function cannot see.
    const grudge: DelayMap = { rock: 0, paper: 0, scissors: 1, lizard: 0, robot: 0 };
    expect(cooldownCause('robot', ['rock'], grudge)).toBe('Robot is on cooldown');
  });

  it('stops blaming the opening once the opening marks would have gone', () => {
    // Robot opens a duel on 2, so by the third pick that mark is long spent and
    // whatever is holding it down now is not the opening.
    expect(cooldownCause('robot', ['scissors', 'paper', 'rock'], duel)).toBe(
      'Robot is on cooldown',
    );
  });
});

describe('describeBeatsGraph (JQ-157)', () => {
  /*
   * The arrows SVG is aria-hidden, so this is the only form of the pentagon a
   * screen reader ever gets. Five lines carry all ten edges.
   */
  it('covers all ten beats in one line per move', () => {
    expect(describeBeatsGraph({}).edges).toEqual([
      'Rock crushes Scissors & Lizard',
      'Paper covers Rock & disproves Robot',
      'Scissors cuts Paper & decapitates Lizard',
      'Lizard eats Paper & poisons Robot',
      'Robot smashes Scissors & vaporizes Rock',
    ]);
  });

  it('says the graph is fully live when the opponent has no cooldowns', () => {
    expect(describeBeatsGraph({}).opponent).toBe(
      'The opponent can play every move this round, so every arrow is live.',
    );
  });

  it('names the attacks the opponent cannot make, which the board draws faded', () => {
    expect(describeBeatsGraph({ lizard: 2, robot: 1 }).opponent).toBe(
      "The opponent can't play Lizard or Robot this round, so those attacks are drawn faded.",
    );
  });

  it('reads a single unavailable move without a list', () => {
    expect(describeBeatsGraph({ rock: 1 }).opponent).toBe(
      "The opponent can't play Rock this round, so those attacks are drawn faded.",
    );
  });

  it('ignores moves whose cooldown has run out', () => {
    expect(describeBeatsGraph({ rock: 0, lizard: 2 }).opponent).toContain("can't play Lizard");
    expect(describeBeatsGraph({ rock: 0, lizard: 2 }).opponent).not.toContain('Rock');
  });
});

describe('describeBeatsGraph naming', () => {
  it('says "The opponent" when there is a you to be opposite', () => {
    expect(describeBeatsGraph({}).opponent).toBe(
      'The opponent can play every move this round, so every arrow is live.',
    );
  });

  it('names the other player on a replay, where nobody is "you"', () => {
    expect(describeBeatsGraph({}, 'Ben').opponent).toBe(
      'Ben can play every move this round, so every arrow is live.',
    );
    expect(describeBeatsGraph({ robot: 2 }, 'Ben').opponent).toBe(
      "Ben can't play Robot this round, so those attacks are drawn faded.",
    );
  });

  it('falls back to the anonymous form for a blank name', () => {
    expect(describeBeatsGraph({}, '  ').opponent).toMatch(/^The opponent/);
  });
});

describe('isPlayable defers to the server floor (JQ-215)', () => {
  it('is the zero-marked moves when any move is on zero', () => {
    const delays = { rock: 0, paper: 0, scissors: 0, lizard: 1, robot: 2 };
    expect(ALL_MOVES.filter((m) => isPlayable(m, delays))).toEqual(['rock', 'paper', 'scissors']);
  });

  it('falls back to the least-marked when nothing is on zero', () => {
    // The floor: no move is clear, so the two on 1 mark become playable.
    const delays = { rock: 2, paper: 1, scissors: 3, lizard: 1, robot: 4 };
    expect(ALL_MOVES.filter((m) => isPlayable(m, delays))).toEqual(['paper', 'lizard']);
  });

  it('never leaves a player with nothing to play', () => {
    const delays = { rock: 3, paper: 3, scissors: 3, lizard: 3, robot: 3 };
    expect(ALL_MOVES.filter((m) => isPlayable(m, delays))).toHaveLength(5);
  });

  it('treats a missing key as zero rather than collapsing to nothing', () => {
    // `Math.min` over a partial map is NaN, and NaN matches no move, so an
    // unguarded call returns the empty list — every move unplayable. The
    // picker holds partial maps, so this case is the common one, not the edge.
    expect(isPlayable('rock', {})).toBe(true);
    expect(ALL_MOVES.filter((m) => isPlayable(m, {}))).toHaveLength(5);
    expect(isPlayable('lizard', { lizard: 2 })).toBe(false);
    expect(isPlayable('rock', { lizard: 2 })).toBe(true);
  });
});

describe('isForcedPick — marked, and playable anyway (JQ-215)', () => {
  it('is empty whenever any move is on zero', () => {
    const delays = { rock: 0, paper: 0, scissors: 0, lizard: 1, robot: 2 };
    expect(ALL_MOVES.filter((m) => isForcedPick(m, delays))).toEqual([]);
  });

  it('is the least-marked moves when nothing is on zero', () => {
    const delays = { rock: 2, paper: 1, scissors: 3, lizard: 1, robot: 4 };
    expect(ALL_MOVES.filter((m) => isForcedPick(m, delays))).toEqual(['paper', 'lizard']);
  });

  it('is false for a move that is playable because it is clear', () => {
    expect(isForcedPick('rock', {})).toBe(false);
  });
});
