import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLobbyPlayerProfile, reportMatchResult, resolveClaimDisplayName } from './lobbyClient.js';

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

  it('reportMatchResult POSTs lifecycle mutation with service token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: { reportMatchResult: true } }),
      })),
    );

    const ok = await reportMatchResult(
      'https://joinquest.cc/graphql',
      'svc-secret',
      'match-uuid',
      'COMPLETED',
      ['user-a'],
    );
    expect(ok).toBe(true);

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://joinquest.cc/graphql');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer svc-secret');
    const body = JSON.parse(init.body as string) as { variables: Record<string, unknown> };
    expect(body.variables.matchId).toBe('match-uuid');
    expect(body.variables.status).toBe('COMPLETED');
  });

  it('reportMatchResult logs and returns false on GraphQL errors', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ errors: [{ message: 'session not found' }] }),
      })),
    );

    const ok = await reportMatchResult(
      'https://joinquest.cc/graphql',
      'svc-secret',
      'match-uuid',
      'COMPLETED',
    );
    expect(ok).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      '[lobby] reportMatchResult GraphQL errors:',
      expect.objectContaining({ matchId: 'match-uuid' }),
    );
    warn.mockRestore();
  });
});
