import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig CORS', () => {
  it('always includes GAME_API_AUDIENCE as an allowed browser origin', () => {
    const config = loadConfig({
      GAME_APP_ENV: 'production',
      GAME_API_AUDIENCE: 'https://rpsls-duel.win',
      CORS_ALLOWED_ORIGINS: '',
    } as NodeJS.ProcessEnv);
    expect(config.corsAllowedOrigins).toContain('https://rpsls-duel.win');
  });

  it('strips trailing /api from base URL when used as JWT audience', () => {
    const cfg = loadConfig({
      GAME_API_BASE_URL: 'https://rps.staging.joinquest.example/api',
    });
    expect(cfg.tokenAudiences).toEqual(['https://rps.staging.joinquest.example']);
  });

  it('merges explicit CORS with audience without duplicates', () => {
    const config = loadConfig({
      GAME_API_AUDIENCE: 'https://game.example',
      CORS_ALLOWED_ORIGINS: 'https://joinquest.cc,https://game.example',
    } as NodeJS.ProcessEnv);
    expect(config.corsAllowedOrigins).toEqual([
      'https://joinquest.cc',
      'https://game.example',
    ]);
  });
});

describe('client origin', () => {
  it('falls back to the play URL when no client origin is configured', () => {
    const config = loadConfig({ GAME_PLAY_URL: 'https://rpsls-duel.win' } as NodeJS.ProcessEnv);
    expect(config.clientOrigin).toBe('https://rpsls-duel.win');
  });

  it('prefers an explicit client origin, so k8s can point at the in-cluster service', () => {
    const config = loadConfig({
      GAME_PLAY_URL: 'https://rpsls-duel.win',
      GAME_CLIENT_ORIGIN: 'http://rps-game-client',
    } as NodeJS.ProcessEnv);
    expect(config.clientOrigin).toBe('http://rps-game-client');
  });
});
