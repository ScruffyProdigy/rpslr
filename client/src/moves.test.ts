import { describe, expect, it } from 'vitest';
import type { DelayMap, MarkEvent } from '@game/game';
import {
  ALL_MOVES,
  MOVE_META,
  SHARED_BEATS,
  addedEdgesOf,
  backInPhrase,
  cooldownReason,
  holdsFreeze,
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
  roundCap,
  winsNeeded,
  isPlayable,
  isForcedPick,
} from './moves';
import type { Move } from './api';

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

  it('caps a match at twice its nominal length', () => {
    expect(roundCap(3)).toBe(6);
    expect(roundCap(5)).toBe(10);
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
    // Called through a lambda, not passed by reference: `beatsOf` takes an
    // optional graph second, and `flatMap` would hand it the array index.
    const beaten = ALL_MOVES.flatMap((m) => beatsOf(m));
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
    expect(winningEdgeOf('rock', 'scissors')).toEqual({
      from: 'rock',
      to: 'scissors',
      role: 'you',
      added: false,
    });
  });

  // The edge is the graph's, not the viewer's — only `role` flips.
  it('marks the edge as the opponent’s when they win', () => {
    expect(winningEdgeOf('scissors', 'rock')).toEqual({
      from: 'rock',
      to: 'scissors',
      role: 'opp',
      added: false,
    });
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
          expect(edge!.added).toBe(false);
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

describe('the opponent gets the floor too (JQ-215)', () => {
  /** Every move marked; Paper and Lizard tied on the fewest. */
  const THEIRS = { rock: 2, paper: 1, scissors: 3, lizard: 1, robot: 4 };

  it('does not call a move safe when the floor leaves a threat live', () => {
    // Paper beats Rock, and the floor makes Paper playable — so Rock is not
    // safe. Reading marks directly would call it safe and get you beaten.
    const t = threatsTo('rock', THEIRS);
    expect(t.live).toEqual(['paper']);
    expect(t.safe).toBe(false);
  });

  it('says the graph is fully live when the floor gives them everything back', () => {
    expect(describeBeatsGraph({ rock: 3, paper: 3, scissors: 3, lizard: 3, robot: 3 }).opponent).toBe(
      'The opponent can play every move this round, so every arrow is live.',
    );
  });

  it('names only the moves the floor did not reach', () => {
    expect(describeBeatsGraph(THEIRS).opponent).toBe(
      "The opponent can't play Rock, Scissors or Robot this round, so those attacks are drawn faded.",
    );
  });
});

/**
 * Per-player graphs (JQ-151).
 *
 * Phase 2 and 3 exist to teach a fixed ten-edge graph that tells the truth about
 * both players. A conditional graph makes every arrow ask "whose?", so these hold
 * two lines: the shared ten never change, and the extra edge is always visible and
 * always attributed.
 */
const CHIMERA_BEATS = { ...SHARED_BEATS, lizard: ['robot', 'paper', 'scissors'] as Move[] };

describe('an edge a loadout added', () => {
  it('is found against the shared graph, not against a list of card names', () => {
    expect(addedEdgesOf(CHIMERA_BEATS)).toEqual([{ from: 'lizard', to: 'scissors' }]);
  });

  it('finds none at all in a duel, which is what keeps the ten untouched', () => {
    expect(addedEdgesOf(SHARED_BEATS)).toEqual([]);
  });

  it('comes last in beatsOf, after the two edges everyone learned', () => {
    expect(beatsOf('lizard', CHIMERA_BEATS)).toEqual(['paper', 'robot', 'scissors']);
  });

  it('leaves every other move of a Chimera owner exactly as it was', () => {
    for (const m of ALL_MOVES.filter((x) => x !== 'lizard')) {
      expect(beatsOf(m, CHIMERA_BEATS)).toEqual(beatsOf(m));
    }
  });
});

describe('describeBeatsOf with an added edge', () => {
  // The fallback verb, deliberately: api/src/replayCard/moveVerbs.ts phrases the
  // same pair the same way, and the card and the board must not disagree about a
  // round the player just watched.
  it('names all three, with the extra one last', () => {
    expect(describeBeatsOf('lizard', CHIMERA_BEATS)).toBe(
      'Lizard eats Paper, poisons Robot & beats Scissors',
    );
  });

  it('says nothing different about the ten shared edges', () => {
    for (const m of ALL_MOVES.filter((x) => x !== 'lizard')) {
      expect(describeBeatsOf(m, CHIMERA_BEATS)).toBe(describeBeatsOf(m));
    }
  });
});

describe('threatsTo reads the opponent’s graph', () => {
  // The safe-move read is "what can beat me", so it is *their* graph that decides
  // it. Reading your own would tell a Chimera holder their Scissors was safe from
  // a Lizard it is not safe from.
  it('counts an edge the opponent was granted as a threat', () => {
    // In ALL_MOVES order, so the added edge lands in the middle rather than last.
    expect(threatsTo('scissors', {}).all).toEqual(['rock', 'robot']);
    expect(threatsTo('scissors', {}, CHIMERA_BEATS).all).toEqual(['rock', 'lizard', 'robot']);
  });

  it('still drops the ones they cannot play, added edge included', () => {
    const t = threatsTo('scissors', { robot: 2, rock: 2 }, CHIMERA_BEATS);
    expect(t.live).toEqual(['lizard']);
    expect(t.safe).toBe(false);
  });

  it('is safe again once the granted edge is on cooldown too', () => {
    expect(threatsTo('scissors', { robot: 2, rock: 2, lizard: 2 }, CHIMERA_BEATS).safe).toBe(true);
  });
});

describe('winningEdgeOf with per-player graphs', () => {
  // Mirrors the engine's `seatWinner`: an added edge outranks a shared one. Reading
  // each side through only its own graph would light both arrows on the pair.
  it('lets the added edge take the round it decides', () => {
    expect(winningEdgeOf('lizard', 'scissors', { mine: CHIMERA_BEATS })).toEqual({
      from: 'lizard',
      to: 'scissors',
      role: 'you',
      added: true,
    });
  });

  it('gives the same pair to the opponent when the edge is theirs', () => {
    expect(winningEdgeOf('scissors', 'lizard', { theirs: CHIMERA_BEATS })).toEqual({
      from: 'lizard',
      to: 'scissors',
      role: 'opp',
      added: true,
    });
  });

  it('leaves the pair to the shared graph when nobody was granted it', () => {
    expect(winningEdgeOf('lizard', 'scissors')).toEqual({
      from: 'scissors',
      to: 'lizard',
      role: 'opp',
      added: false,
    });
  });
});

describe('describeBeatsGraph names the extra edges out loud', () => {
  it('says nothing extra in a duel', () => {
    expect(describeBeatsGraph({}).added).toEqual([]);
  });

  it('names your own', () => {
    expect(describeBeatsGraph({}, undefined, { mine: CHIMERA_BEATS }).added).toEqual([
      'Your Lizard also beats Scissors this match',
    ]);
  });

  // The opponent must be able to hear the rule they are playing against: an edge
  // rendered on their screen only for its owner is a rule they cannot see.
  it('names theirs too, by name where there is one', () => {
    expect(describeBeatsGraph({}, 'Ben', { theirs: CHIMERA_BEATS }).added).toEqual([
      "Ben's Lizard also beats Scissors this match",
    ]);
    expect(describeBeatsGraph({}, undefined, { theirs: CHIMERA_BEATS }).added).toEqual([
      'Their Lizard also beats Scissors this match',
    ]);
  });

  it('leaves the five shared lines word for word as they were', () => {
    expect(describeBeatsGraph({}, undefined, { mine: CHIMERA_BEATS }).edges).toEqual(
      describeBeatsGraph({}).edges,
    );
  });
});

describe('cooldownReason (JQ-151)', () => {
  const duel: DelayMap = { rock: 0, paper: 0, scissors: 0, lizard: 1, robot: 2 };
  const event = (over: Partial<MarkEvent>): MarkEvent => ({
    round: 0,
    side: 'a',
    move: 'rock',
    amount: 2,
    cause: { kind: 'choice' },
    ...over,
  });

  it('falls back to the duel wording with no ledger at all', () => {
    expect(cooldownReason('rock', ['rock'], duel)).toBe('You played Rock last round');
  });

  it('blames your own pick when your own pick is what did it', () => {
    expect(cooldownReason('rock', ['rock'], duel, [event({})])).toBe('You played Rock last round');
  });

  // The headline case: a move you never touched, down because they put it down.
  it('names the opponent and the card when they inflicted it', () => {
    const ledger = [event({ move: 'paper', cause: { kind: 'helper', helperId: 'quarantine', mine: false } })];
    expect(cooldownReason('paper', ['rock'], duel, ledger)).toBe(
      'Their Quarantine put 2 marks on Paper',
    );
  });

  it('names your own card when the marks are your own doing', () => {
    const ledger = [event({ move: 'robot', cause: { kind: 'helper', helperId: 'feint', mine: true } })];
    expect(cooldownReason('robot', [], duel, ledger)).toBe('Your Feint put 2 marks on Robot');
  });

  it('agrees on the singular', () => {
    const ledger = [event({ move: 'paper', amount: 1, cause: { kind: 'helper', helperId: 'rust', mine: false } })];
    expect(cooldownReason('paper', [], duel, ledger)).toBe('Their Rust put 1 mark on Paper');
  });

  it('reads the most recent cause, not the first', () => {
    const ledger = [
      event({ round: 0, move: 'paper', cause: { kind: 'helper', helperId: 'rust', mine: false } }),
      event({ round: 1, move: 'paper', cause: { kind: 'choice' } }),
    ];
    expect(cooldownReason('paper', ['paper'], duel, ledger)).toBe('You played Paper last round');
  });

  // Flywheel taking a mark off is not why the move is still down.
  it('ignores removals, which explain nothing about a move still on cooldown', () => {
    const ledger = [
      event({ move: 'paper', cause: { kind: 'helper', helperId: 'quarantine', mine: false } }),
      event({ round: 1, move: 'paper', amount: -1, cause: { kind: 'helper', helperId: 'flywheel', mine: true } }),
    ];
    expect(cooldownReason('paper', [], duel, ledger)).toBe('Their Quarantine put 2 marks on Paper');
  });

  it('blames the opening only where the opening is what put the marks there', () => {
    const ledger = [event({ move: 'robot', amount: 2, cause: { kind: 'opening' } })];
    expect(cooldownReason('robot', ['rock'], duel, ledger)).toBe('Robot starts the match on cooldown');
  });

  it('says nothing about a move the ledger has no cause for', () => {
    expect(cooldownReason('robot', ['rock', 'paper', 'scissors'], duel, [event({})])).toBe(
      'Robot is on cooldown',
    );
  });
});

describe('backInPhrase (JQ-151)', () => {
  it('counts turns when nothing can stop the decrement', () => {
    expect(backInPhrase(2)).toBe('back in 2 turns');
    expect(backInPhrase(1)).toBe('back in 1 turn');
  });

  // Freeze stops marks coming off for a round, so "back in 2 turns" becomes wrong
  // the moment it lands. Loadouts are public, so whether that is even possible is
  // knowable — and where it is, the sentence states marks instead of promising turns.
  it('states marks instead of promising turns against a Freeze holder', () => {
    expect(backInPhrase(2, true)).toBe('2 marks to clear');
    expect(backInPhrase(1, true)).toBe('1 mark to clear');
  });

  it('reads Freeze off the loadout rather than guessing', () => {
    expect(holdsFreeze(['freeze', 'chimera'])).toBe(true);
    expect(holdsFreeze(['chimera', 'ferrus'])).toBe(false);
    expect(holdsFreeze(null)).toBe(false);
  });
});
