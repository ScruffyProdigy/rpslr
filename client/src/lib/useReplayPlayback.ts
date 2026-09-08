import { useCallback, useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from './reducedMotion';

/**
 * How long the showdown card holds before it starts to go. Its own
 * choreography finishes around 1470ms — the verdict lands at 1150 and takes
 * 320 to arrive — so the rest is time to read it.
 */
export const CARD_MS = 2400;

/**
 * The dissolve, matching `REVEAL_OUTRO_MS` in `useRoundReveal`: the card fades
 * and the pentagon edge the round was won on lights up underneath it.
 */
export const OUTRO_MS = 600;

/**
 * The beat after the card has gone, with the lit edge alone on the graph.
 *
 * A live match does not need this — the player watched the round happen and is
 * already thinking about the next one. A watcher did not, and the arrow is the
 * one thing on screen that says *why* the round went the way it did, in the
 * game's own vocabulary rather than in a sentence. Under the card it is
 * competing with a verdict; on its own it is the point.
 */
export const STRIKE_MS = 900;

/** A whole round: the card, the dissolve, then the arrow on its own. */
export const ROUND_MS = CARD_MS + OUTRO_MS + STRIKE_MS;

export type PlaybackSpeed = 1 | 2;

/**
 * Where a round is in its own little arc.
 *
 * 'reveal' is the card playing itself out, 'outro' is it dissolving onto the
 * winning arrow, and 'strike' is that arrow held alone once the card has gone.
 * 'settled' is a round nobody is watching go past — paused, stepped to, or
 * read under reduced motion — which shows everything at once because there is
 * no motion left to carry it.
 */
export type RoundBeat = 'reveal' | 'outro' | 'strike' | 'settled';

export interface Playback {
  index: number;
  /** How far through its own arc the round on screen is. */
  beat: RoundBeat;
  playing: boolean;
  speed: PlaybackSpeed;
  atEnd: boolean;
  /** Reduced motion: nothing moves on its own, the watcher steps. */
  stepping: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  setSpeed: (speed: PlaybackSpeed) => void;
  jumpTo: (index: number) => void;
}

/**
 * Which round of a replay is on screen, and whether it is moving on its own.
 *
 * Under `prefers-reduced-motion` a replay does not play — it steps. The
 * request is not "animate more gently", it is "do not move without me", and a
 * page that advances itself every three seconds ignores that however softly it
 * fades. `stepping` lets the page drop the play control rather than show one
 * that does nothing.
 */
export function useReplayPlayback(
  frameCount: number,
  /**
   * Something on top of the replay has the watcher's attention — the rules
   * panels, opened on a first visit over a replay that has already started
   * playing. The replay stops where it is without being paused, so closing
   * whatever it was resumes exactly what it interrupted and nothing has to
   * remember what that was.
   */
  held: boolean = false,
): Playback {
  const stepping = useRef(prefersReducedMotion()).current;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(!stepping && frameCount > 1);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [elapsed, setElapsed] = useState<Exclude<RoundBeat, 'settled'>>('reveal');

  const last = Math.max(0, frameCount - 1);
  const atEnd = index >= last;

  const clamp = useCallback((next: number) => Math.min(last, Math.max(0, next)), [last]);

  // The page mounts before the match has loaded, so the hook's first call knows
  // of no frames at all. Auto-play has to begin when the frames arrive rather
  // than at mount — otherwise a replay opened from a link never plays.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || stepping || frameCount <= 1) return;
    autoStarted.current = true;
    setPlaying(true);
  }, [stepping, frameCount]);

  // A round is only an arc while it is going past on its own. A watcher who
  // paused or stepped here is reading, not watching, and gets the whole round
  // at once rather than a frame of an animation they stopped.
  const moving = playing && !stepping && !held;
  const beat: RoundBeat = !moving ? 'settled' : elapsed;

  // Two hand-offs inside a round: the card starts dissolving, then it is gone
  // and the arrow has the graph to itself. Both are reset by `index`, so a
  // jump or a step lands at the start of the arc rather than partway through.
  useEffect(() => {
    if (!moving) return;
    setElapsed('reveal');
    const toOutro = setTimeout(() => setElapsed('outro'), CARD_MS / speed);
    const toStrike = setTimeout(() => setElapsed('strike'), (CARD_MS + OUTRO_MS) / speed);
    return () => {
      clearTimeout(toOutro);
      clearTimeout(toStrike);
    };
  }, [moving, index, speed]);

  useEffect(() => {
    if (stepping || !playing || held) return;
    if (index >= last) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setIndex((cur) => Math.min(last, cur + 1)), ROUND_MS / speed);
    return () => clearTimeout(timer);
  }, [stepping, playing, held, index, last, speed]);

  const play = useCallback(() => {
    if (stepping) return;
    setIndex((cur) => (cur >= last ? 0 : cur));
    setPlaying(true);
  }, [stepping, last]);

  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => (playing ? pause() : play()), [playing, pause, play]);

  // Taking a step is taking control; the replay should not resume underneath.
  const next = useCallback(() => {
    setPlaying(false);
    setIndex((cur) => clamp(cur + 1));
  }, [clamp]);

  const prev = useCallback(() => {
    setPlaying(false);
    setIndex((cur) => clamp(cur - 1));
  }, [clamp]);

  const jumpTo = useCallback(
    (target: number) => {
      setPlaying(false);
      setIndex(clamp(target));
    },
    [clamp],
  );

  return {
    index,
    beat,
    playing,
    speed,
    atEnd,
    stepping,
    play,
    pause,
    toggle,
    next,
    prev,
    setSpeed,
    jumpTo,
  };
}
