import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Move } from '../api';
import { readPlayAlong, scoreGuesses, writePlayAlong } from './usePlayAlong';

/** Just enough of a frame for the scorer: the round, and what was played. */
function frame(round: number, move: Move) {
  return { round, a: { move } };
}

const frames = [frame(1, 'rock'), frame(2, 'paper'), frame(3, 'lizard')];

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('scoreGuesses', () => {
  it('scores nothing before a round has been called', () => {
    expect(scoreGuesses(frames, {})).toEqual({ called: 0, hits: 0 });
  });

  it('counts a call that matched what was played', () => {
    expect(scoreGuesses(frames, { 1: 'rock' })).toEqual({ called: 1, hits: 1 });
  });

  it('counts a wrong call as called but not hit', () => {
    expect(scoreGuesses(frames, { 1: 'paper', 3: 'lizard' })).toEqual({ called: 2, hits: 1 });
  });

  it('leaves a skipped round out of both numbers', () => {
    // Skipping is offered, so it cannot also be scored as a miss.
    expect(scoreGuesses(frames, { 1: 'rock', 2: null })).toEqual({ called: 1, hits: 1 });
  });

  it('ignores a call for a round the replay does not have', () => {
    expect(scoreGuesses(frames, { 9: 'rock' })).toEqual({ called: 0, hits: 0 });
  });
});

describe('play-along preference', () => {
  it('watches, from the first seat, until told otherwise', () => {
    expect(readPlayAlong()).toEqual({ on: false, side: 0 });
  });

  it('remembers the mode and the side across reloads', () => {
    writePlayAlong({ on: true, side: 1 });
    expect(readPlayAlong()).toEqual({ on: true, side: 1 });
  });

  it('keeps the chosen side after going back to watching', () => {
    writePlayAlong({ on: true, side: 1 });
    writePlayAlong({ on: false, side: 1 });
    expect(readPlayAlong()).toEqual({ on: false, side: 1 });
  });

  it('falls back to watching when storage cannot be read', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readPlayAlong()).toEqual({ on: false, side: 0 });
  });

  it('carries on when storage cannot be written', () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => writePlayAlong({ on: true, side: 1 })).not.toThrow();
  });
});
