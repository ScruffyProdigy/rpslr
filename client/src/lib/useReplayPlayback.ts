import { useCallback, useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from './reducedMotion';

/**
 * How long one round holds on screen at 1x: both picks, the showdown, and a
 * beat to read it. Roughly the live match's reveal hold, so a replay feels
 * like the game rather than a slideshow of it.
 */
export const ROUND_MS = 3000;

export type PlaybackSpeed = 1 | 2;

export interface Playback {
  index: number;
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
export function useReplayPlayback(frameCount: number): Playback {
  const stepping = useRef(prefersReducedMotion()).current;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(!stepping && frameCount > 1);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);

  const last = Math.max(0, frameCount - 1);
  const atEnd = index >= last;

  const clamp = useCallback((next: number) => Math.min(last, Math.max(0, next)), [last]);

  useEffect(() => {
    if (stepping || !playing) return;
    if (index >= last) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setIndex((cur) => Math.min(last, cur + 1)), ROUND_MS / speed);
    return () => clearTimeout(timer);
  }, [stepping, playing, index, last, speed]);

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
