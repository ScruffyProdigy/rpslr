import { describe, expect, it } from 'vitest';
import { claimsFromPayload, TokenError } from './tokens.js';

describe('claimsFromPayload', () => {
  it('extracts assignment claims (camelCase)', () => {
    const claims = claimsFromPayload({
      iss: 'https://joinquest.cc',
      sub: 'u_alice',
      matchId: 'lobby-1',
      seatKey: 'white',
      name: 'Alice',
    });
    expect(claims).toEqual({
      lobbyIssuer: 'https://joinquest.cc',
      lobbyUserId: 'u_alice',
      externalMatchId: 'lobby-1',
      seatKey: 'white',
      displayName: 'Alice',
    });
  });

  it('accepts snake_case claim names too', () => {
    const claims = claimsFromPayload({
      iss: 'http://localhost:8080',
      sub: 'u_bob',
      match_id: 'lobby-2',
      seat_key: 'b',
    });
    expect(claims.externalMatchId).toBe('lobby-2');
    expect(claims.seatKey).toBe('b');
  });

  it('throws when iss is missing', () => {
    expect(() =>
      claimsFromPayload({ sub: 'u_alice', matchId: 'm', seatKey: 'a' }),
    ).toThrow(/iss/);
  });

  it('throws when required claims are missing', () => {
    expect(() => claimsFromPayload({ iss: 'https://x.test', sub: 'u_alice' })).toThrow(TokenError);
  });
});
