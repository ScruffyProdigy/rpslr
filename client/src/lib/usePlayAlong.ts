import { useCallback, useState } from 'react';
import type { Move } from '../api';

/**
 * Watching a replay, or calling the next move before it lands.
 *
 * A replay is the cheapest possible first play: the watcher already has the
 * board, both players' cooldowns and a move to guess. Play-along turns that
 * into a game — pick what you think the player you are standing behind is
 * about to throw, then watch the round resolve — using the same two-tap
 * picker they will meet in a real match rather than a mode of its own.
 *
 * The mode is a browser preference rather than match state: someone who came
 * to play should not have to say so again on the next replay link.
 */

/** Which of the two seats, in board order, the watcher is calling for. */
export type CallSide = 0 | 1;

/**
 * Rounds the watcher has answered, by round number. A move is a call; `null`
 * is a round they let go by; a round that is absent has not been reached.
 */
export type Guesses = Record<number, Move | null>;

export interface GuessScore {
  /** Rounds actually called — skipped and unreached rounds are not in here. */
  called: number;
  /** Calls that matched what was played. */
  hits: number;
}

/** The least of a replay frame the scorer needs: a round, and what was played. */
interface ScorableFrame {
  round: number;
  a: { move: Move };
}

/**
 * How the calls went. Skipping is offered per round, so a skipped round cannot
 * also be scored as a miss — it leaves both numbers alone, and "3 of 5" means
 * five rounds called rather than five rounds played.
 */
export function scoreGuesses(frames: readonly ScorableFrame[], guesses: Guesses): GuessScore {
  let called = 0;
  let hits = 0;
  for (const frame of frames) {
    const guess = guesses[frame.round];
    if (!guess) continue;
    called += 1;
    if (guess === frame.a.move) hits += 1;
  }
  return { called, hits };
}

export interface PlayAlongPref {
  on: boolean;
  side: CallSide;
}

const MODE_KEY = 'rpslr.replay.playAlong';
const SIDE_KEY = 'rpslr.replay.callSide';

/**
 * Stored separately so the side outlives the mode: someone who played along as
 * the second seat and went back to watching is still that player's fan.
 *
 * Storage can throw — Safari private mode, an iframe with third-party storage
 * blocked — so every access is guarded and failure just means watching.
 */
export function readPlayAlong(): PlayAlongPref {
  try {
    return {
      on: window.localStorage.getItem(MODE_KEY) === '1',
      side: window.localStorage.getItem(SIDE_KEY) === '1' ? 1 : 0,
    };
  } catch {
    return { on: false, side: 0 };
  }
}

export function writePlayAlong(pref: PlayAlongPref): void {
  try {
    window.localStorage.setItem(MODE_KEY, pref.on ? '1' : '0');
    window.localStorage.setItem(SIDE_KEY, String(pref.side));
  } catch {
    /* storage unavailable — the mode is simply not remembered */
  }
}

export interface PlayAlong {
  on: boolean;
  side: CallSide;
  guesses: Guesses;
  setOn: (on: boolean) => void;
  setSide: (side: CallSide) => void;
  call: (round: number, move: Move) => void;
  skip: (round: number) => void;
}

export function usePlayAlong(): PlayAlong {
  const [pref, setPref] = useState<PlayAlongPref>(readPlayAlong);
  const [guesses, setGuesses] = useState<Guesses>({});

  // Starting a run clears the last one; going back to watching does not, so
  // the end card can still say how the calls went. Switching sides always
  // clears: a call made for one player is not a call made for the other.
  const setOn = useCallback(
    (on: boolean) => {
      const next = { ...pref, on };
      setPref(next);
      writePlayAlong(next);
      if (on) setGuesses({});
    },
    [pref],
  );

  const setSide = useCallback(
    (side: CallSide) => {
      const next = { ...pref, side };
      setPref(next);
      writePlayAlong(next);
      setGuesses({});
    },
    [pref],
  );

  const call = useCallback((round: number, move: Move) => {
    setGuesses((cur) => ({ ...cur, [round]: move }));
  }, []);

  const skip = useCallback((round: number) => {
    setGuesses((cur) => ({ ...cur, [round]: null }));
  }, []);

  return { on: pref.on, side: pref.side, guesses, setOn, setSide, call, skip };
}
