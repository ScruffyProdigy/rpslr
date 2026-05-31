import { describe, expect, it } from 'vitest';
import { buildGameModesPayload, GAME_MODES, getGameMode } from './gameModes.js';

describe('game-modes manifest', () => {
  it('exposes duel mode with Lobby field names', () => {
    const duel = getGameMode('duel');
    expect(duel?.key).toBe('duel');
    expect(duel?.displayName).toBeTruthy();
    expect(duel?.seats).toHaveLength(2);
    expect(duel).not.toHaveProperty('bestOf');
  });

  it('buildGameModesPayload matches GET /api/v1/game-modes shape', () => {
    const body = buildGameModesPayload('rock-paper-scissors-lizard-spock');
    expect(body.game).toBe('rock-paper-scissors-lizard-spock');
    expect(body.modes).toEqual(GAME_MODES);
    expect(body.modes[0]).not.toHaveProperty('bestOf');
  });
});
