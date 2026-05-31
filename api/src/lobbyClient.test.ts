import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLobbyPlayerProfile, resolveClaimDisplayName } from './lobbyClient.js';

describe('lobbyClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetchLobbyPlayerProfile POSTs to provision graphqlUrl with serviceToken', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: { player: { id: '11111111-1111-4111-8111-111111111111', displayName: 'Quest Hero' } },
        }),
      })),
    );

    const profile = await fetchLobbyPlayerProfile(
      'https://joinquest.cc/graphql',
      '11111111-1111-4111-8111-111111111111',
      'svc-secret',
    );
    expect(profile?.displayName).toBe('Quest Hero');

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://joinquest.cc/graphql');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer svc-secret');
  });

  it('resolveClaimDisplayName prefers Lobby GraphQL over generic fallback', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: { player: { displayName: 'From GraphQL' } } }),
      })),
    );

    const name = await resolveClaimDisplayName(
      {
        lobbyIssuer: 'https://joinquest.cc',
        lobbyUserId: 'u-1',
        externalMatchId: 'match-1',
        seatKey: 'a',
      },
      'https://joinquest.cc/graphql',
      'svc-secret',
    );
    expect(name).toBe('From GraphQL');
  });

  it('resolveClaimDisplayName uses JWT name without calling Lobby', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const name = await resolveClaimDisplayName(
      {
        lobbyIssuer: 'https://joinquest.cc',
        lobbyUserId: 'u-1',
        externalMatchId: 'match-1',
        seatKey: 'a',
        displayName: 'JWT Name',
      },
      'https://joinquest.cc/graphql',
      'svc-secret',
    );
    expect(name).toBe('JWT Name');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
