import { describe, expect, it, vi } from 'vitest';
import { TtlCache } from './cache.js';

describe('TtlCache', () => {
  it('returns what it was given, until it expires', () => {
    vi.useFakeTimers();
    try {
      const cache = new TtlCache<string>(1000);
      cache.set('k', 'v');
      expect(cache.get('k')).toBe('v');
      vi.advanceTimersByTime(1001);
      expect(cache.get('k')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('knows nothing about a key it was never given', () => {
    expect(new TtlCache<string>(1000).get('nope')).toBeUndefined();
  });

  it('drops the oldest entry rather than growing without bound', () => {
    const cache = new TtlCache<number>(60_000, 2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('forgets everything on clear', () => {
    const cache = new TtlCache<number>(60_000);
    cache.set('a', 1);
    cache.clear();
    expect(cache.get('a')).toBeUndefined();
  });
});
