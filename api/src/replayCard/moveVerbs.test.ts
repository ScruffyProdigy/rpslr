import { describe, expect, it } from 'vitest';
import { MOVES, decideRound } from '../game.js';
import { FALLBACK_VERB, beatVerb, showdownCaption, verbPairs } from './moveVerbs.js';

const key = ([winner, loser]: [string, string]) => `${winner} > ${loser}`;

describe('moveVerbs', () => {
  // The point of this file. The verbs are a copy of the client's, and the copy
  // is only safe while something checks it against the rules the server plays
  // by. A shared matchup that gains or loses a verb fails here.
  it('names exactly the matchups the shared graph decides', () => {
    const named = verbPairs().map(key).sort();
    const decided = MOVES.flatMap((winner) =>
      MOVES.filter((loser) => winner !== loser && decideRound(winner, loser) === 'a').map((loser) =>
        key([winner, loser]),
      ),
    ).sort();
    expect(named).toEqual(decided);
  });

  it('claims exactly the ten matchups RPSLR has', () => {
    expect(verbPairs()).toHaveLength(10);
  });

  // Belt to the braces above: a matchup cannot be quietly retired by handing it
  // the fallback, which would still leave the two sets equal.
  it('gives each of those a verb of its own, never the fallback', () => {
    for (const [winner, loser] of verbPairs()) {
      expect(beatVerb(winner, loser)).not.toBe(FALLBACK_VERB);
    }
  });

  it('phrases a showdown the way the rules copy does', () => {
    expect(showdownCaption('paper', 'rock')).toBe('Paper covers Rock');
    expect(showdownCaption('robot', 'rock')).toBe('Robot vaporizes Rock');
    expect(showdownCaption('scissors', 'lizard')).toBe('Scissors decapitates Lizard');
  });

  // Chimera gives its owner `lizard → scissors`, and the card reads a finished
  // match: the winner is recorded, the loadout is not, so there is nothing to
  // ask. A win the shared table cannot name still has to read as a win, and it
  // has to read the way the client's board read it — which is "beats".
  it('phrases a win the shared graph does not have', () => {
    expect(beatVerb('lizard', 'scissors')).toBe('beats');
    expect(showdownCaption('lizard', 'scissors')).toBe('Lizard beats Scissors');
  });

  it('has nothing to say about a move against itself, which nobody won', () => {
    expect(showdownCaption('rock', 'rock')).toBeNull();
  });
});
