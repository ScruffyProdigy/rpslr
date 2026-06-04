import { describe, expect, it } from 'vitest';
import { buildLobbyReturnLink } from './lobbyReturn';

describe('buildLobbyReturnLink', () => {
  it('appends match id to the return hub URL', () => {
    expect(buildLobbyReturnLink('https://joinquest.cc/return', 'session-123')).toBe(
      'https://joinquest.cc/return?match=session-123',
    );
  });

  it('returns the base when no match id', () => {
    expect(buildLobbyReturnLink('https://joinquest.cc/return', null)).toBe('https://joinquest.cc/return');
  });

  it('preserves existing query params', () => {
    expect(buildLobbyReturnLink('https://joinquest.cc/return?foo=bar', 'abc')).toBe(
      'https://joinquest.cc/return?foo=bar&match=abc',
    );
  });

  it('falls back for relative paths', () => {
    expect(buildLobbyReturnLink('/return', 'abc')).toBe('/return?match=abc');
  });
});
