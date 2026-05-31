import { describe, expect, it } from 'vitest';
import { parseLobbyProvision, verifyLobbyProvisionAuth } from './provision.js';

export const LOBBY_ENDPOINTS = {
  returnUrl: 'https://joinquest.cc',
  graphqlUrl: 'https://joinquest.cc/graphql',
  serviceToken: 'lobby-svc-secret',
};

describe('parseLobbyProvision', () => {
  const example = {
    lobbyId: 'https://joinquest.cc',
    lobby: LOBBY_ENDPOINTS,
    assignment: {
      externalMatchId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      gameMode: 'duel',
      seats: [
        { seatKey: 'a', lobbyUserId: '11111111-1111-4111-8111-111111111111' },
        { seatKey: 'b', lobbyUserId: '22222222-2222-4222-8222-222222222222' },
      ],
    },
  };

  it('accepts the Lobby provision envelope', () => {
    const parsed = parseLobbyProvision(example);
    expect(typeof parsed).not.toBe('string');
    if (typeof parsed === 'string') return;
    expect(parsed.lobbyId).toBe('https://joinquest.cc');
    expect(parsed.lobby).toEqual(LOBBY_ENDPOINTS);
    expect(parsed.assignment.externalMatchId).toBe(example.assignment.externalMatchId);
    expect(parsed.assignment.seats).toHaveLength(2);
    expect(parsed.assignment.bestOf).toBeUndefined();
  });

  it('requires lobbyId', () => {
    expect(parseLobbyProvision({ lobby: LOBBY_ENDPOINTS, assignment: example.assignment })).toMatch(
      /lobbyId/,
    );
  });

  it('requires lobby.returnUrl and lobby.graphqlUrl', () => {
    expect(parseLobbyProvision({ lobbyId: 'https://x.test', assignment: example.assignment })).toMatch(
      /lobby/,
    );
    expect(
      parseLobbyProvision({
        lobbyId: 'https://x.test',
        lobby: { returnUrl: 'https://x.test' },
        assignment: example.assignment,
      }),
    ).toMatch(/graphqlUrl/);
  });

  it('accepts provision without lobby.serviceToken (dev / Lobby without game service token)', () => {
    const parsed = parseLobbyProvision({
      lobbyId: 'https://joinquest.cc',
      lobby: {
        returnUrl: 'https://joinquest.cc',
        graphqlUrl: 'https://joinquest.cc/graphql',
      },
      assignment: example.assignment,
    });
    expect(typeof parsed).not.toBe('string');
    if (typeof parsed === 'string') return;
    expect(parsed.lobby.serviceToken).toBeUndefined();
  });
});

describe('verifyLobbyProvisionAuth', () => {
  it('allows missing auth when serviceToken is omitted', () => {
    expect(verifyLobbyProvisionAuth(undefined, undefined)).toBeNull();
  });

  it('requires matching Bearer when serviceToken is set', () => {
    expect(verifyLobbyProvisionAuth(undefined, 'secret')).toMatch(/Authorization/);
    expect(verifyLobbyProvisionAuth('Bearer wrong', 'secret')).toMatch(/Authorization/);
    expect(verifyLobbyProvisionAuth('Bearer secret', 'secret')).toBeNull();
  });
});
