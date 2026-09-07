import { describe, expect, it } from 'vitest';
import { PresenceTracker } from './presence.js';

describe('PresenceTracker', () => {
  it('reports a player it has never seen as present', () => {
    // REST-only clients never open a socket. Treating unknown as "gone" would
    // forfeit them the moment the grace period elapsed.
    const p = new PresenceTracker(() => 1_000);
    expect(p.disconnectedSince('m1', 'nobody')).toBeNull();
  });

  it('reports a connected player as present', () => {
    const p = new PresenceTracker(() => 1_000);
    p.connect('m1', 'p1');
    expect(p.disconnectedSince('m1', 'p1')).toBeNull();
  });

  it('records when a player dropped', () => {
    let now = 1_000;
    const p = new PresenceTracker(() => now);
    p.connect('m1', 'p1');
    now = 5_000;
    p.disconnect('m1', 'p1');
    expect(p.disconnectedSince('m1', 'p1')).toBe(5_000);
  });

  it('keeps the original drop time across repeated reads', () => {
    let now = 1_000;
    const p = new PresenceTracker(() => now);
    p.connect('m1', 'p1');
    now = 5_000;
    p.disconnect('m1', 'p1');
    now = 9_000;
    expect(p.disconnectedSince('m1', 'p1')).toBe(5_000);
  });

  it('clears the drop time when the player comes back', () => {
    let now = 1_000;
    const p = new PresenceTracker(() => now);
    p.connect('m1', 'p1');
    now = 5_000;
    p.disconnect('m1', 'p1');
    now = 6_000;
    p.connect('m1', 'p1');
    expect(p.disconnectedSince('m1', 'p1')).toBeNull();
  });

  it('stays present while any of the player’s tabs is still open', () => {
    let now = 1_000;
    const p = new PresenceTracker(() => now);
    p.connect('m1', 'p1');
    p.connect('m1', 'p1'); // second tab
    now = 5_000;
    p.disconnect('m1', 'p1'); // first tab closes
    expect(p.disconnectedSince('m1', 'p1')).toBeNull();
    p.disconnect('m1', 'p1'); // last tab closes
    expect(p.disconnectedSince('m1', 'p1')).toBe(5_000);
  });

  it('never counts connections below zero', () => {
    let now = 1_000;
    const p = new PresenceTracker(() => now);
    p.connect('m1', 'p1');
    p.disconnect('m1', 'p1');
    p.disconnect('m1', 'p1'); // stray close for a socket already gone
    now = 2_000;
    p.connect('m1', 'p1');
    expect(p.disconnectedSince('m1', 'p1')).toBeNull();
  });

  it('keeps matches and players separate', () => {
    let now = 1_000;
    const p = new PresenceTracker(() => now);
    p.connect('m1', 'p1');
    p.connect('m2', 'p1');
    now = 5_000;
    p.disconnect('m1', 'p1');
    expect(p.disconnectedSince('m1', 'p1')).toBe(5_000);
    expect(p.disconnectedSince('m2', 'p1')).toBeNull();
  });

  it('forgets a match once it is over', () => {
    let now = 1_000;
    const p = new PresenceTracker(() => now);
    p.connect('m1', 'p1');
    now = 5_000;
    p.disconnect('m1', 'p1');
    p.forget('m1');
    expect(p.disconnectedSince('m1', 'p1')).toBeNull();
  });
});
