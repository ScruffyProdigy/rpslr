import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUND_MS, useReplayPlayback } from './useReplayPlayback';

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
