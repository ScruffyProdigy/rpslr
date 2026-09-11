import { describe, expect, it } from 'vitest';
import {
  clearSeatBindingCookie,
  decodeSeatBinding,
  encodeSeatBinding,
  readCookie,
  seatBindingCookie,
  SEAT_BINDING_COOKIE,
  type SeatBinding,
} from './seatBinding.js';

const BINDING: SeatBinding = {
  externalMatchId: 'lobby-match-1',
  seatKey: '1',
  lobbyUserId: 'u_alice',
  playerId: 'p-abc-123',
};

describe('seat binding encoding', () => {
  it('round-trips a binding', () => {
    expect(decodeSeatBinding(encodeSeatBinding(BINDING))).toEqual(BINDING);
  });

  it('reads nothing out of junk rather than throwing', () => {
    expect(decodeSeatBinding(undefined)).toBeNull();
    expect(decodeSeatBinding('')).toBeNull();
    expect(decodeSeatBinding('not-base64-{{{')).toBeNull();
    // Valid base64url, but not JSON we wrote.
    expect(decodeSeatBinding(Buffer.from('[]').toString('base64url'))).toBeNull();
  });

  it('refuses a binding missing any of the four fields', () => {
    const partial = Buffer.from(JSON.stringify({ m: 'x', s: '1', u: 'u' })).toString('base64url');
    expect(decodeSeatBinding(partial)).toBeNull();
  });
});

describe('cookie plumbing', () => {
  it('finds its own cookie among others', () => {
    const header = `theme=dark; ${SEAT_BINDING_COOKIE}=${encodeSeatBinding(BINDING)}; other=1`;
    expect(decodeSeatBinding(readCookie(header, SEAT_BINDING_COOKIE))).toEqual(BINDING);
  });

  it('returns null when the cookie is absent', () => {
    expect(readCookie('theme=dark', SEAT_BINDING_COOKIE)).toBeNull();
    expect(readCookie(undefined, SEAT_BINDING_COOKIE)).toBeNull();
  });

  it('writes an HttpOnly, same-site cookie, Secure only over https', () => {
    const insecure = seatBindingCookie(BINDING, { secure: false });
    expect(insecure).toContain('HttpOnly');
    expect(insecure).toContain('SameSite=Lax');
    expect(insecure).not.toContain('Secure');
    expect(seatBindingCookie(BINDING, { secure: true })).toContain('Secure');
  });

  it('clears with a Max-Age of 0', () => {
    expect(clearSeatBindingCookie({ secure: false })).toContain('Max-Age=0');
  });
});
