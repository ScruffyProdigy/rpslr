import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CARD_MS, OUTRO_MS, ROUND_MS, useReplayPlayback } from './useReplayPlayback';

function setReducedMotion(reduce: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: reduce,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  setReducedMotion(false);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useReplayPlayback', () => {
  it('starts on the first round and plays by itself', () => {
    const { result } = renderHook(() => useReplayPlayback(3));
    expect(result.current.index).toBe(0);
    expect(result.current.playing).toBe(true);

    act(() => void vi.advanceTimersByTime(ROUND_MS));
    expect(result.current.index).toBe(1);
  });

  it('runs twice as fast at 2x', () => {
    const { result } = renderHook(() => useReplayPlayback(3));
    act(() => result.current.setSpeed(2));
    act(() => void vi.advanceTimersByTime(ROUND_MS / 2));
    expect(result.current.index).toBe(1);
  });

  it('stops on the last round rather than looping', () => {
    const { result } = renderHook(() => useReplayPlayback(2));
    act(() => void vi.advanceTimersByTime(ROUND_MS * 4));
    expect(result.current.index).toBe(1);
    expect(result.current.atEnd).toBe(true);
    expect(result.current.playing).toBe(false);
  });

  it('pauses and resumes', () => {
    const { result } = renderHook(() => useReplayPlayback(4));
    act(() => result.current.pause());
    act(() => void vi.advanceTimersByTime(ROUND_MS * 3));
    expect(result.current.index).toBe(0);

    act(() => result.current.play());
    act(() => void vi.advanceTimersByTime(ROUND_MS));
    expect(result.current.index).toBe(1);
  });

  it('steps in both directions and clamps at the ends', () => {
    const { result } = renderHook(() => useReplayPlayback(3));
    act(() => result.current.pause());

    act(() => result.current.prev());
    expect(result.current.index).toBe(0);

    act(() => result.current.next());
    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.index).toBe(2);
  });

  it('stops playing when the watcher takes over with a step', () => {
    const { result } = renderHook(() => useReplayPlayback(3));
    expect(result.current.playing).toBe(true);
    act(() => result.current.next());
    expect(result.current.playing).toBe(false);
  });

  it('jumps to a round and clamps out-of-range jumps', () => {
    const { result } = renderHook(() => useReplayPlayback(3));
    act(() => result.current.jumpTo(2));
    expect(result.current.index).toBe(2);
    act(() => result.current.jumpTo(99));
    expect(result.current.index).toBe(2);
    act(() => result.current.jumpTo(-4));
    expect(result.current.index).toBe(0);
  });

  it('never auto-advances under prefers-reduced-motion', () => {
    setReducedMotion(true);
    const { result } = renderHook(() => useReplayPlayback(3));
    expect(result.current.stepping).toBe(true);
    expect(result.current.playing).toBe(false);

    act(() => void vi.advanceTimersByTime(ROUND_MS * 5));
    expect(result.current.index).toBe(0);

    act(() => result.current.play());
    act(() => void vi.advanceTimersByTime(ROUND_MS * 5));
    expect(result.current.index).toBe(0);

    act(() => result.current.next());
    expect(result.current.index).toBe(1);
  });
});

describe('useReplayPlayback arriving after the match loads', () => {
  it('starts playing once the frames turn up, not only if they were there at mount', () => {
    // The page mounts before `api.getState` resolves, so the hook is first
    // called with 0 frames. A replay that only auto-plays when the count was
    // known at mount never auto-plays at all.
    const { result, rerender } = renderHook(({ count }) => useReplayPlayback(count), {
      initialProps: { count: 0 },
    });
    expect(result.current.playing).toBe(false);

    rerender({ count: 5 });
    expect(result.current.playing).toBe(true);

    act(() => void vi.advanceTimersByTime(ROUND_MS));
    expect(result.current.index).toBe(1);
  });

  it('does not restart itself after the watcher pauses', () => {
    const { result, rerender } = renderHook(({ count }) => useReplayPlayback(count), {
      initialProps: { count: 0 },
    });
    rerender({ count: 5 });
    act(() => result.current.pause());
    rerender({ count: 5 });
    expect(result.current.playing).toBe(false);
  });

  it('stays still when the frames arrive and motion is unwelcome', () => {
    setReducedMotion(true);
    const { result, rerender } = renderHook(({ count }) => useReplayPlayback(count), {
      initialProps: { count: 0 },
    });
    rerender({ count: 5 });
    expect(result.current.playing).toBe(false);
  });
});

describe('useReplayPlayback round beats', () => {
  it('plays the card, dissolves it, then leaves the arrow on its own', () => {
    // The stylesheet already stages the card — clash, verb, verdict at 1150ms
    // — off one mount, so playback leaves it alone and then takes it away. The
    // beat after that is the whole reason a replay has beats: the winning edge
    // alone on the graph, saying why the round went the way it did.
    const { result } = renderHook(() => useReplayPlayback(3));
    expect(result.current.beat).toBe('reveal');

    act(() => void vi.advanceTimersByTime(CARD_MS));
    expect(result.current.beat).toBe('outro');

    act(() => void vi.advanceTimersByTime(OUTRO_MS));
    expect(result.current.beat).toBe('strike');
    expect(result.current.index).toBe(0);

    act(() => void vi.advanceTimersByTime(ROUND_MS - CARD_MS - OUTRO_MS));
    expect(result.current.index).toBe(1);
    expect(result.current.beat).toBe('reveal');
  });

  it('scales every beat with the speed, not just the round', () => {
    const { result } = renderHook(() => useReplayPlayback(3));
    act(() => result.current.setSpeed(2));

    act(() => void vi.advanceTimersByTime(CARD_MS / 2));
    expect(result.current.beat).toBe('outro');
    act(() => void vi.advanceTimersByTime(OUTRO_MS / 2));
    expect(result.current.beat).toBe('strike');
  });

  it('starts a jumped-to round at the top of its arc, not partway through', () => {
    const { result } = renderHook(() => useReplayPlayback(4));
    act(() => void vi.advanceTimersByTime(CARD_MS));
    expect(result.current.beat).toBe('outro');

    act(() => result.current.jumpTo(3));
    act(() => result.current.play());
    expect(result.current.beat).toBe('reveal');
  });

  it('holds a paused round whole — verdict read, nothing dissolving', () => {
    const { result } = renderHook(() => useReplayPlayback(3));
    act(() => result.current.pause());
    expect(result.current.beat).toBe('settled');

    act(() => result.current.next());
    expect(result.current.beat).toBe('settled');
  });

  it('settles immediately under prefers-reduced-motion', () => {
    setReducedMotion(true);
    const { result } = renderHook(() => useReplayPlayback(3));
    expect(result.current.beat).toBe('settled');
  });
});
