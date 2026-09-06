import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useFirstMatchRules } from './useFirstMatchRules';

afterEach(() => window.localStorage.clear());

describe('useFirstMatchRules', () => {
  it('stays shut until both seats are filled', () => {
    const { result, rerender } = renderHook(({ seated }) => useFirstMatchRules(seated), {
      initialProps: { seated: false },
    });
    expect(result.current.open).toBe(false);
    rerender({ seated: true });
    expect(result.current.open).toBe(true);
  });

  it('opens immediately when the match starts already full', () => {
    const { result } = renderHook(() => useFirstMatchRules(true));
    expect(result.current.open).toBe(true);
  });

  it('never opens itself again once dismissed', () => {
    const first = renderHook(() => useFirstMatchRules(true));
    act(() => first.result.current.dismiss());
    expect(first.result.current.open).toBe(false);

    const second = renderHook(() => useFirstMatchRules(true));
    expect(second.result.current.open).toBe(false);
  });

  it('still opens on demand after being dismissed', () => {
    const first = renderHook(() => useFirstMatchRules(true));
    act(() => first.result.current.dismiss());

    const second = renderHook(() => useFirstMatchRules(true));
    act(() => second.result.current.setOpen(true));
    expect(second.result.current.open).toBe(true);
  });

  // A seat emptying and refilling mid-match is a reconnect, not a new match.
  it('does not reopen when the seats fill a second time', () => {
    const { result, rerender } = renderHook(({ seated }) => useFirstMatchRules(seated), {
      initialProps: { seated: true },
    });
    act(() => result.current.dismiss());
    rerender({ seated: false });
    rerender({ seated: true });
    expect(result.current.open).toBe(false);
  });
});
