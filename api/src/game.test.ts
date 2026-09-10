import { describe, expect, it } from 'vitest';
import {
  availableMoves,
  BASE_RULES,
  BEATS,
  computeDelays,
  decideRound,
  INITIAL_DELAYS,
  replayMatch,
  seatWinner,
  type Move,
  type PlayerRules,
  isMove,
  matchOutcome,
  matchWinner,
  roundCap,
  winsNeeded,
} from './game.js';

describe('decideRound (RPSLR)', () => {
  it('rock beats scissors and lizard', () => {
    expect(decideRound('rock', 'scissors')).toBe('a');
    expect(decideRound('rock', 'lizard')).toBe('a');
  });

  it('paper beats rock and robot', () => {
    expect(decideRound('paper', 'rock')).toBe('a');
    expect(decideRound('paper', 'robot')).toBe('a');
  });

  it('scissors beats paper and lizard', () => {
    expect(decideRound('scissors', 'paper')).toBe('a');
    expect(decideRound('scissors', 'lizard')).toBe('a');
  });

  it('lizard beats robot and paper', () => {
    expect(decideRound('lizard', 'robot')).toBe('a');
    expect(decideRound('lizard', 'paper')).toBe('a');
  });

  it('robot beats scissors and rock', () => {
    expect(decideRound('robot', 'scissors')).toBe('a');
    expect(decideRound('robot', 'rock')).toBe('a');
  });

  it('is symmetric (loser perspective)', () => {
    expect(decideRound('scissors', 'rock')).toBe('b');
    expect(decideRound('robot', 'paper')).toBe('b');
  });

  it('identical moves draw', () => {
    expect(decideRound('robot', 'robot')).toBe('draw');
    expect(decideRound('lizard', 'lizard')).toBe('draw');
  });
});

describe('isMove', () => {
  it('accepts the five valid moves', () => {
    for (const m of ['rock', 'paper', 'scissors', 'lizard', 'robot']) {
      expect(isMove(m)).toBe(true);
    }
  });

  it('rejects invalid input', () => {
    expect(isMove('dynamite')).toBe(false);
    expect(isMove(42)).toBe(false);
  });
});

describe('delay marks (cooldown system)', () => {
  it('starts with lizard at 1 and robot at 2', () => {
    expect(INITIAL_DELAYS).toEqual({ rock: 0, paper: 0, scissors: 0, lizard: 1, robot: 2 });
    expect(availableMoves(INITIAL_DELAYS).sort()).toEqual(['paper', 'rock', 'scissors']);
  });

  it('after a choice: all decrement by 1, chosen gains 2', () => {
    const d = computeDelays(['rock']);
    expect(d).toEqual({ rock: 2, paper: 0, scissors: 0, lizard: 0, robot: 1 });
    // lizard is now available (1 -> 0); rock is now blocked (0 -> +2)
    expect(availableMoves(d).sort()).toEqual(['lizard', 'paper', 'scissors']);
  });

  it('replays a sequence to the right state', () => {
    // r1 rock -> {rock2, robot1, lizard0}; r2 lizard -> decrement then +2 lizard
    const d = computeDelays(['rock', 'lizard']);
    expect(d).toEqual({ rock: 1, paper: 0, scissors: 0, lizard: 2, robot: 0 });
  });

  it('never floors below zero', () => {
    const d = computeDelays(['rock', 'paper', 'scissors']);
    expect(Object.values(d).every((n) => n >= 0)).toBe(true);
  });
});

describe('winsNeeded / matchWinner', () => {
  it('best-of-5 needs 3 wins', () => {
    expect(winsNeeded(5)).toBe(3);
  });

  it('declares a winner only at the threshold', () => {
    expect(matchWinner(2, 1, 3)).toBeNull();
    expect(matchWinner(3, 1, 3)).toBe('a');
    expect(matchWinner(0, 3, 3)).toBe('b');
  });
});

describe('roundCap / matchOutcome', () => {
  it('gives a best-of-5 twice its length before the cap bites', () => {
    expect(roundCap(5)).toBe(10);
    expect(roundCap(3)).toBe(6);
  });

  it('leaves a match open while it is under the cap', () => {
    expect(matchOutcome(1, 1, 5, 9)).toBeNull();
  });

  it('still ends on the win threshold, well before the cap', () => {
    expect(matchOutcome(3, 0, 5, 3)).toBe('a');
    expect(matchOutcome(0, 3, 5, 4)).toBe('b');
  });

  it('awards a capped match to the higher score', () => {
    expect(matchOutcome(2, 1, 5, 10)).toBe('a');
    expect(matchOutcome(1, 2, 5, 10)).toBe('b');
  });

  it('declares a draw when the cap is reached level', () => {
    expect(matchOutcome(2, 2, 5, 10)).toBe('draw');
    expect(matchOutcome(0, 0, 5, 10)).toBe('draw');
  });
});

describe('decideRound with a per-player graph', () => {
  it('is unchanged when no table is passed', () => {
    expect(decideRound('rock', 'scissors')).toBe('a');
    expect(decideRound('scissors', 'rock')).toBe('b');
    expect(decideRound('rock', 'rock')).toBe('draw');
  });

  it('reads the table it is handed, without changing the shared one', () => {
    const sixEdges = { ...BEATS, lizard: [...BEATS.lizard, 'scissors' as const] };
    expect(decideRound('lizard', 'scissors', sixEdges)).toBe('a');
    expect(decideRound('lizard', 'scissors')).toBe('b');
    expect(BEATS.lizard).toEqual(['robot', 'paper']);
  });
});

describe('replayMatch', () => {
  it('reproduces the duel cooldown sequence', () => {
    const rounds = [
      { a: 'rock' as const, b: 'paper' as const },
      { a: 'scissors' as const, b: 'lizard' as const },
    ];
    const { a } = replayMatch(rounds, BASE_RULES, BASE_RULES);
    // rock played round 1 (2 marks, then one decrement), scissors played round 2 (2).
    expect(a).toEqual({ rock: 1, paper: 0, scissors: 2, lizard: 0, robot: 0 });
  });

  it('agrees with computeDelays for every duel sequence', () => {
    const rounds = [
      { a: 'rock' as const, b: 'paper' as const },
      { a: 'paper' as const, b: 'rock' as const },
      { a: 'scissors' as const, b: 'scissors' as const },
    ];
    const { a, b } = replayMatch(rounds, BASE_RULES, BASE_RULES);
    expect(a).toEqual(computeDelays(rounds.map((r) => r.a)));
    expect(b).toEqual(computeDelays(rounds.map((r) => r.b)));
  });

  it("lets one player's rules reach across and mark the other's moves", () => {
    // A's rules add a mark to whatever move beat them.
    const vindictive: PlayerRules = {
      ...BASE_RULES,
      adjustAfterRound: ({ opponent, outcome }) =>
        outcome === 'loss' ? { own: {}, opponent: { [opponent]: 1 } } : { own: {}, opponent: {} },
    };
    const rounds = [{ a: 'paper' as const, b: 'scissors' as const }];
    const { b } = replayMatch(rounds, vindictive, BASE_RULES);
    expect(b.scissors).toBe(3); // 2 for playing it, +1 reaching across
  });

  it("lets an added edge take the round off the graph everyone else shares", () => {
    // A sees a sixth edge; B's graph still says scissors beats lizard. One winner:
    // the added edge, so A wins and B is charged for a loss.
    const chimeric: PlayerRules = {
      ...BASE_RULES,
      beats: { ...BASE_RULES.beats, lizard: [...BASE_RULES.beats.lizard, 'scissors'] },
      delayOnChoice: ({ outcome }) => (outcome === 'win' ? 3 : 2),
    };
    const plain: PlayerRules = {
      ...BASE_RULES,
      delayOnChoice: ({ outcome }) => (outcome === 'loss' ? 1 : 2),
    };
    const { a, b } = replayMatch([{ a: 'lizard', b: 'scissors' }], chimeric, plain);
    expect(a.lizard).toBe(3); // A read it as a win
    expect(b.scissors).toBe(1); // B read it as a loss
  });

  it('starts from the marks the rules bring, not the duel opening', () => {
    const loaded: PlayerRules = {
      ...BASE_RULES,
      initialDelays: { rock: 0, paper: 0, scissors: 0, lizard: 2, robot: 1 },
    };
    const { a } = replayMatch([], loaded, BASE_RULES);
    expect(a).toEqual({ rock: 0, paper: 0, scissors: 0, lizard: 2, robot: 1 });
  });

  it('floors marks at zero rather than going negative', () => {
    const rounds = [
      { a: 'rock' as const, b: 'rock' as const },
      { a: 'paper' as const, b: 'paper' as const },
      { a: 'scissors' as const, b: 'scissors' as const },
      { a: 'rock' as const, b: 'rock' as const },
    ];
    const { a } = replayMatch(rounds, BASE_RULES, BASE_RULES);
    expect(Object.values(a).every((n) => n >= 0)).toBe(true);
  });
});

describe('seatWinner', () => {
  const withEdge = (from: Move, to: Move): PlayerRules => ({
    ...BASE_RULES,
    beats: { ...BASE_RULES.beats, [from]: [...BASE_RULES.beats[from], to] },
  });

  it('falls through to the shared graph when nobody added an edge', () => {
    expect(seatWinner({ a: 'rock', b: 'scissors' }, BASE_RULES, BASE_RULES)).toBe('a');
    expect(seatWinner({ a: 'scissors', b: 'rock' }, BASE_RULES, BASE_RULES)).toBe('b');
    expect(seatWinner({ a: 'rock', b: 'rock' }, BASE_RULES, BASE_RULES)).toBe('draw');
  });

  it("lets A's added edge overturn the edge B already had", () => {
    const chimera = withEdge('lizard', 'scissors');
    expect(seatWinner({ a: 'lizard', b: 'scissors' }, chimera, BASE_RULES)).toBe('a');
    // Held by B instead, the same round goes the other way.
    expect(seatWinner({ a: 'scissors', b: 'lizard' }, BASE_RULES, chimera)).toBe('b');
  });

  it('leaves rounds the added edge does not touch alone', () => {
    const chimera = withEdge('lizard', 'scissors');
    expect(seatWinner({ a: 'lizard', b: 'rock' }, chimera, BASE_RULES)).toBe('b');
    expect(seatWinner({ a: 'scissors', b: 'lizard' }, chimera, BASE_RULES)).toBe('a');
  });

  it('is still a draw when both hold the same added edge and mirror', () => {
    const chimera = withEdge('lizard', 'scissors');
    expect(seatWinner({ a: 'lizard', b: 'lizard' }, chimera, chimera)).toBe('draw');
  });

  it('gives the round to whichever side the added edge actually applies to', () => {
    const chimera = withEdge('lizard', 'scissors');
    // Both hold it, but only A's lizard is on the table.
    expect(seatWinner({ a: 'lizard', b: 'scissors' }, chimera, chimera)).toBe('a');
    expect(seatWinner({ a: 'scissors', b: 'lizard' }, chimera, chimera)).toBe('b');
  });
});

describe('availableMoves never leaves a player with nothing to do', () => {
  it('is the moves on zero marks, when there are any', () => {
    expect(availableMoves({ rock: 0, paper: 0, scissors: 0, lizard: 1, robot: 2 }).sort()).toEqual([
      'paper',
      'rock',
      'scissors',
    ]);
    expect(availableMoves({ rock: 0, paper: 0, scissors: 0, lizard: 0, robot: 0 })).toHaveLength(5);
  });

  it('falls back to the least-marked move when helpers have blocked everything', () => {
    // Quarantine deepening what was played, Rust taking the last clear move.
    expect(availableMoves({ rock: 3, paper: 4, scissors: 1, lizard: 2, robot: 4 })).toEqual([
      'scissors',
    ]);
  });

  it('offers every move that ties for least-marked', () => {
    expect(availableMoves({ rock: 2, paper: 2, scissors: 3, lizard: 4, robot: 2 }).sort()).toEqual([
      'paper',
      'robot',
      'rock',
    ]);
  });

  it('is never empty, for any reachable mark count', () => {
    // 6^5 maps, which covers every combination a match could put on the board.
    const counts = [0, 1, 2, 3, 4, 5];
    for (const rock of counts)
      for (const paper of counts)
        for (const scissors of counts)
          for (const lizard of counts)
            for (const robot of counts) {
              const delays = { rock, paper, scissors, lizard, robot };
              expect(availableMoves(delays).length, JSON.stringify(delays)).toBeGreaterThan(0);
            }
  });

  it('leaves the duel opening untouched', () => {
    expect(availableMoves(INITIAL_DELAYS).sort()).toEqual(['paper', 'rock', 'scissors']);
  });
});
