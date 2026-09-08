import { describe, expect, it } from 'vitest';
import { prequeueFixture, serialize } from './fixtures.testutil.js';
import { GAME_NAME } from './config.js';
import { buildGameModesPayload, GAME_MODES, getGameMode } from './gameModes.js';

describe('game-modes manifest', () => {
  it('exposes duel mode with Lobby field names', () => {
    const duel = getGameMode('duel');
    expect(duel?.key).toBe('duel');
    expect(duel?.displayName).toBeTruthy();
    expect(duel?.seatTemplate).toEqual({ count: 2 });
    expect(duel).not.toHaveProperty('bestOf');
  });

  it('leaves duel without a preQueue block, which is how Lobby knows not to send options', () => {
    expect(getGameMode('duel')).not.toHaveProperty('preQueue');
  });

  it('exposes duel-helpers as a second two-seat mode', () => {
    const mode = getGameMode('duel-helpers');
    expect(mode?.displayName).toBe('Helpers');
    expect(mode?.minPlayers).toBe(2);
    expect(mode?.maxPlayers).toBe(2);
    expect(mode?.seatTemplate).toEqual({ count: 2 });
    expect(mode).not.toHaveProperty('bestOf');
  });

  it('declares one selection group of two helpers, with the price-ladder section order', () => {
    const group = getGameMode('duel-helpers')?.preQueue?.groups[0];
    expect(group).toEqual({
      key: 'helpers',
      kind: 'Loadout',
      label: 'Choose your two helpers',
      min: 2,
      max: 2,
      sectionOrder: ['Major', 'Minor', 'Trinket'],
      locking: 'none',
    });
  });

  it('declares exactly one group — three sections inside one, not three groups', () => {
    expect(getGameMode('duel-helpers')?.preQueue?.groups).toHaveLength(1);
  });

  it('buildGameModesPayload matches GET /api/v1/game-modes shape', () => {
    const body = buildGameModesPayload('rock-paper-scissors-lizard-robot');
    expect(body.game).toBe('rock-paper-scissors-lizard-robot');
    expect(body.modes).toEqual(GAME_MODES);
    expect(body.modes[0]).not.toHaveProperty('bestOf');
  });

  it('matches the contract fixture field for field, in order', () => {
    expect(serialize(buildGameModesPayload(GAME_NAME))).toBe(
      serialize(prequeueFixture('game-modes.duel-helpers')),
    );
  });
});
