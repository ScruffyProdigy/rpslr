import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useFirstMatchRules } from './useFirstMatchRules';

afterEach(() => window.localStorage.clear());

// The once-only behaviour below is what the flag will be flipped back to; the
// temporary always-show override is asserted in its own block at the bottom.
describe('useFirstMatchRules', () => {
  it('stays shut until both seats are filled', () => {
    const { result, rerender } = renderHook(({ seated }) => useFirstMatchRules(seated, false), {
      initialProps: { seated: false },
    });
    expect(result.current.open).toBe(false);
    rerender({ seated: true });
    expect(result.current.open).toBe(true);
  });

  it('opens immediately when the match starts already full', () => {
    const { result } = renderHook(() => useFirstMatchRules(true, false));
    expect(result.current.open).toBe(true);
  });

  it('never opens itself again once dismissed', () => {
    const first = renderHook(() => useFirstMatchRules(true, false));
    act(() => first.result.current.dismiss());
    expect(first.result.current.open).toBe(false);

    const second = renderHook(() => useFirstMatchRules(true, false));
    expect(second.result.current.open).toBe(false);
  });

  it('still opens on demand after being dismissed', () => {
    const first = renderHook(() => useFirstMatchRules(true, false));
    act(() => first.result.current.dismiss());

    const second = renderHook(() => useFirstMatchRules(true, false));
    act(() => second.result.current.setOpen(true));
    expect(second.result.current.open).toBe(true);
  });

  // A seat emptying and refilling mid-match is a reconnect, not a new match.
  it('does not reopen when the seats fill a second time', () => {
    const { result, rerender } = renderHook(({ seated }) => useFirstMatchRules(seated, false), {
      initialProps: { seated: true },
    });
    act(() => result.current.dismiss());
    rerender({ seated: false });
    rerender({ seated: true });
    expect(result.current.open).toBe(false);
  });
});

describe('useFirstMatchRules always-show override', () => {
  it('opens even for a player who has already dismissed it', () => {
    const first = renderHook(() => useFirstMatchRules(true, true));
    act(() => first.result.current.dismiss());
    const second = renderHook(() => useFirstMatchRules(true, true));
    expect(second.result.current.open).toBe(true);
  });
});
