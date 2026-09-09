import { describe, expect, it, vi } from 'vitest';
import { MatchHub } from './matchHub.js';
import type { MatchSnapshot } from './matchView.js';

// The hub forwards snapshots, not states (JQ-220): one match has as many views as
// it has seats, and picking one is the subscriber's job, not the bus's.
const fakeState = (id: string) =>
  ({ shared: { match: { id } }, abilitiesByPlayerId: {} }) as unknown as MatchSnapshot;

describe('MatchHub', () => {
  it('delivers published state to subscribers of that match only', () => {
    const hub = new MatchHub();
    const a = vi.fn();
    const b = vi.fn();
    hub.subscribe('match-1', a);
    hub.subscribe('match-2', b);

    hub.publish('match-1', fakeState('match-1'));

    expect(a).toHaveBeenCalledOnce();
    expect(b).not.toHaveBeenCalled();
  });

  it('stops delivering after unsubscribe', () => {
    const hub = new MatchHub();
    const listener = vi.fn();
    const off = hub.subscribe('m', listener);
    hub.publish('m', fakeState('m'));
    off();
    hub.publish('m', fakeState('m'));
    expect(listener).toHaveBeenCalledOnce();
    expect(hub.listenerCount('m')).toBe(0);
  });
});
