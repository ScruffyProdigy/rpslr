import { describe, expect, it } from 'vitest';
import { lobbyIssuersMatch, lobbyJwksUrl, normalizeLobbyIssuer } from './lobbyIssuer.js';

describe('lobbyIssuer', () => {
  it('normalizes trailing slashes and query strings', () => {
    expect(normalizeLobbyIssuer('https://joinquest.cc/')).toBe('https://joinquest.cc');
    expect(normalizeLobbyIssuer('https://joinquest.cc?x=1')).toBe('https://joinquest.cc');
  });

  it('derives JWKS URL from issuer', () => {
    expect(lobbyJwksUrl('https://joinquest.cc/')).toBe(
      'https://joinquest.cc/.well-known/jwks.json',
    );
  });

  it('treats provision lobbyId and JWT iss as equal when normalized', () => {
    expect(lobbyIssuersMatch('https://joinquest.cc', 'https://joinquest.cc/')).toBe(true);
    expect(lobbyIssuersMatch('https://joinquest.cc', 'https://evil.example')).toBe(false);
  });
});
