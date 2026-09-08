import { describe, expect, it } from 'vitest';
import { MOVES, decideRound } from '../game.js';
import { beatVerb, showdownCaption, verbPairs } from './moveVerbs.js';

describe('moveVerbs', () => {
  // The point of this file. The verbs are a copy of the client's, and the copy
  // is only safe while something checks it against the rules the server plays
  // by. A move that gains or loses a matchup fails here.
  it('has a verb for every matchup the game actually decides', () => {
    for (const winner of MOVES) {
      for (const loser of MOVES) {
        const wins = decideRound(winner, loser) === 'a' && winner !== loser;
        expect(beatVerb(winner, loser) === null).toBe(!wins);
      }
    }
  });

  it('claims exactly the ten matchups RPSLR has', () => {
    expect(verbPairs()).toHaveLength(10);
  });

  it('phrases a showdown the way the rules copy does', () => {
    expect(showdownCaption('paper', 'rock')).toBe('Paper covers Rock');
    expect(showdownCaption('robot', 'rock')).toBe('Robot vaporizes Rock');
    expect(showdownCaption('scissors', 'lizard')).toBe('Scissors decapitates Lizard');
  });

  it('has nothing to say about a matchup that never happened', () => {
    expect(showdownCaption('rock', 'paper')).toBeNull();
    expect(showdownCaption('rock', 'rock')).toBeNull();
  });
});
