import { afterEach, describe, expect, it } from 'vitest';
import { getEnv, getLobbyLink, getLobbyUserFromUrl, getWebSocketUrl } from './env';

afterEach(() => {
  delete window.env;
});

describe('getEnv', () => {
  it('falls back to local defaults when window.env is empty', () => {
    const env = getEnv();
    expect(env.GAME_APP_ENV).toBe('local');
    expect(env.GAME_API_BASE_URL).toBe('http://localhost:3001');
  });

  it('reads runtime overrides from window.env', () => {
    window.env = {
      GAME_APP_ENV: 'production',
      GAME_API_BASE_URL: 'https://api.example.com',
    };
    const env = getEnv();
    expect(env.GAME_APP_ENV).toBe('production');
    expect(env.GAME_API_BASE_URL).toBe('https://api.example.com');
  });
});

describe('getLobbyUserFromUrl', () => {
  it('extracts the lobby_user query param', () => {
    expect(getLobbyUserFromUrl('?lobby_user=Ada')).toBe('Ada');
  });

  it('returns null when absent', () => {
    expect(getLobbyUserFromUrl('?other=1')).toBeNull();
  });
});

describe('getWebSocketUrl', () => {
  it('derives a ws:// url from an http API base', () => {
    expect(getWebSocketUrl({ GAME_APP_ENV: 'local', GAME_API_BASE_URL: 'http://localhost:3001' })).toBe(
      'ws://localhost:3001/api/v1/ws',
    );
  });

  it('derives wss:// from an https API base', () => {
    expect(
      getWebSocketUrl({ GAME_APP_ENV: 'production', GAME_API_BASE_URL: 'https://rps.example' }),
    ).toBe('wss://rps.example/api/v1/ws');
  });

  it('honors an explicit GAME_WS_BASE_URL override', () => {
    expect(
      getWebSocketUrl({
        GAME_APP_ENV: 'production',
        GAME_API_BASE_URL: 'https://rps.example',
        GAME_WS_BASE_URL: 'wss://ws.rps.example',
      }),
    ).toBe('wss://ws.rps.example/api/v1/ws');
  });

  it('treats an empty-string GAME_WS_BASE_URL as unset (env.js default)', () => {
    // Regression: env.js ships GAME_WS_BASE_URL="" — must fall back to the API
    // base, not produce a relative "/api/v1/ws" that points at the dev server.
    expect(
      getWebSocketUrl({
        GAME_APP_ENV: 'local',
        GAME_API_BASE_URL: 'http://localhost:3001',
        GAME_WS_BASE_URL: '',
      }),
    ).toBe('ws://localhost:3001/api/v1/ws');
  });
});

describe('getLobbyLink', () => {
  it('parses Lobby launch link (match + token + optional seat hints)', () => {
    const link = getLobbyLink('?match=lobby-xyz&token=eyJhbGciOiJIUzI1NiJ9.e30.sig&seat=a&lobby_user=Ada');
    expect(link.matchId).toBe('lobby-xyz');
    expect(link.token).toBe('eyJhbGciOiJIUzI1NiJ9.e30.sig');
    expect(link.seat).toBe('a');
    expect(link.lobbyUser).toBe('Ada');
  });

  it('returns nulls for a bare standalone visit', () => {
    expect(getLobbyLink('')).toEqual({
      matchId: null,
      token: null,
      seat: null,
      lobbyUser: null,
    });
  });
});
