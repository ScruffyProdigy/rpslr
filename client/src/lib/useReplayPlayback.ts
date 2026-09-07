import { useCallback, useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from './reducedMotion';

/**
 * How long one round holds on screen at 1x: both picks, the showdown, and a
 * beat to read it. Roughly the live match's reveal hold, so a replay feels
 * like the game rather than a slideshow of it.
 */
export const ROUND_MS = 3000;

/**
 * How much of a round is spent on the picks alone, before the verdict lands.
 * The drama of a round is seeing what was thrown and working out who won a
 * beat before being told, so the showdown withholds its verdict for this long.
 */
export const PICKS_MS = 1100;

export type PlaybackSpeed = 1 | 2;

/** Where a round is in its own little arc: picks thrown, then verdict. */
export type RoundBeat = 'picks' | 'reveal';

export interface Playback {
  index: number;
  /** Whether the round on screen has given its verdict yet. */
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
export function useReplayPlayback(frameCount: number): Playback {
  const stepping = useRef(prefersReducedMotion()).current;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(!stepping && frameCount > 1);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [revealed, setRevealed] = useState(false);

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

  // A round only holds its verdict back while it is running past on its own. A
  // watcher who paused or stepped here is reading, not watching, and should not
  // have to wait out a beat for the answer.
  const inPicks = playing && !stepping && !revealed;

  useEffect(() => {
    if (!playing || stepping) return;
    setRevealed(false);
    const timer = setTimeout(() => setRevealed(true), PICKS_MS / speed);
    return () => clearTimeout(timer);
  }, [playing, stepping, index, speed]);

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
    beat: inPicks ? 'picks' : 'reveal',
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
