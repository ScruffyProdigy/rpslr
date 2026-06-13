import { describe, expect, it } from 'vitest';
import {
  availableMoves,
  computeDelays,
  decideRound,
  INITIAL_DELAYS,
  isMove,
  matchWinner,
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
