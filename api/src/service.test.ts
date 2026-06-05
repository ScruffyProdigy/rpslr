import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryGameRepository } from './memoryRepository.js';
import { BannedPlayerError, GameService, ValidationError } from './service.js';
import { ConflictError, NotFoundError, ReservationError } from './repository.js';

describe('GameService — standalone duel loop', () => {
  let service: GameService;

  beforeEach(() => {
    service = new GameService(new MemoryGameRepository());
  });

  async function setupMatch(bestOf = 3) {
    const created = await service.createStandaloneMatch({
      name: 'Test',
      hostName: 'Alice',
      bestOf,
    });
    const code = created.state.match.code;
    const hostId = created.you.playerId;
    const joined = await service.claimSeat(code, { seatKey: '2', name: 'Bob' });
    return { code, hostId, challengerId: joined.you.playerId };
  }

  it('seats the host in seat "a" and starts as waiting', async () => {
    const created = await service.createStandaloneMatch({ hostName: 'Alice' });
    expect(created.you.seatKey).toBe('1');
    expect(created.state.match.status).toBe('waiting');
    expect(created.state.match.code).toMatch(/^RPS-/);
  });

  it('flips to playing once all seats are filled', async () => {
    const { code } = await setupMatch();
    const state = await service.getState(code);
    expect(state.match.status).toBe('playing');
    expect(state.seats.every((s) => s.player)).toBe(true);
  });

  it('runs a best-of-3 to a decided winner (respecting cooldowns)', async () => {
    const { code, hostId, challengerId } = await setupMatch(3);
    // r1: rock beats scissors -> host wins. (host rock now on cooldown)
    await service.submitMove(code, hostId, 'rock');
    let state = await service.submitMove(code, challengerId, 'scissors');
    expect(state.results[0].outcome).toBe('1');

    // r2: host can't rock; paper beats rock -> host wins to 2.
    await service.submitMove(code, hostId, 'paper');
    state = await service.submitMove(code, challengerId, 'rock');
    expect(state.match.status).toBe('finished');
    expect(state.matchWinnerSeatKey).toBe('1');
  });

  it('does not score draws', async () => {
    const { code, hostId, challengerId } = await setupMatch(3);
    await service.submitMove(code, hostId, 'rock');
    const state = await service.submitMove(code, challengerId, 'rock');
    expect(state.results[0].outcome).toBe('draw');
    expect(state.seats.every((s) => (s.player?.score ?? 0) === 0)).toBe(true);
  });

  it('rejects an unknown move', async () => {
    const { code, hostId } = await setupMatch();
    await expect(service.submitMove(code, hostId, 'dynamite')).rejects.toBeInstanceOf(ValidationError);
  });

  it('blocks lizard and spock on the opening round (initial cooldown)', async () => {
    const { code, hostId } = await setupMatch();
    await expect(service.submitMove(code, hostId, 'lizard')).rejects.toBeInstanceOf(ValidationError);
    await expect(service.submitMove(code, hostId, 'spock')).rejects.toBeInstanceOf(ValidationError);
  });

  it('blocks re-picking a move that is still on cooldown', async () => {
    const { code, hostId, challengerId } = await setupMatch(5);
    await service.submitMove(code, hostId, 'rock');
    await service.submitMove(code, challengerId, 'paper');
    // host just played rock -> rock now has 2 delay marks, unavailable next round.
    await expect(service.submitMove(code, hostId, 'rock')).rejects.toBeInstanceOf(ValidationError);
  });

  it('exposes per-seat delay marks in match state', async () => {
    const { code, hostId, challengerId } = await setupMatch(5);
    await service.submitMove(code, hostId, 'rock');
    const state = await service.submitMove(code, challengerId, 'paper');
    const seatA = state.seats.find((s) => s.seatKey === '1');
    // After choosing rock: rock=2, spock=1 (2->1), lizard=0 (1->1... decrement then nothing)
    expect(seatA?.delays.rock).toBe(2);
    expect(seatA?.delays.lizard).toBe(0);
    expect(seatA?.delays.spock).toBe(1);
  });

  it('tracks submissions without leaking opponent moves over the wire', async () => {
    const { code, hostId } = await setupMatch();
    const state = await service.submitMove(code, hostId, 'rock');
    expect(state.submittedPlayerIds).toEqual([hostId]);
    expect(state.currentRoundMoves[hostId]).toBe('rock');
    const snapshot = await service.getState(code);
    expect(snapshot.submittedPlayerIds).toEqual([hostId]);
    expect(snapshot.currentRoundMoves).toEqual({});
  });

  it('rejects a duplicate move in the same round', async () => {
    const { code, hostId } = await setupMatch();
    await service.submitMove(code, hostId, 'rock');
    await expect(service.submitMove(code, hostId, 'paper')).rejects.toBeInstanceOf(ConflictError);
  });

  it('blocks moves until all seats are filled', async () => {
    const created = await service.createStandaloneMatch({ hostName: 'Alice' });
    await expect(
      service.submitMove(created.state.match.code, created.you.playerId, 'rock'),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('GameService — Lobby push (option 2)', () => {
  function service(banned: string[] = []) {
    return new GameService(new MemoryGameRepository(), { bannedLobbyUsers: banned });
  }

  const provision = {
    lobbyId: 'https://joinquest.cc',
    lobby: {
      returnUrl: 'https://joinquest.cc',
      graphqlUrl: 'https://joinquest.cc/graphql',
      serviceToken: 'lobby-svc-secret',
    },
    assignment: {
      externalMatchId: 'lobby-match-1',
      gameMode: 'duel',
      seats: [
        { seatKey: '1', lobbyUserId: 'u_alice' },
        { seatKey: '2', lobbyUserId: 'u_bob' },
      ],
    },
  };

  it('provisions without serviceToken when omitted (dev)', async () => {
    const svc = service();
    const { serviceToken: _t, ...lobby } = provision.lobby;
    const state = await svc.ensureMatchFromAssignment({
      ...provision,
      lobby,
    });
    expect(state.match.lobbyServiceToken).toBeNull();
  });

  it('provisions a match with seats reserved for the assigned users', async () => {
    const svc = service();
    const state = await svc.ensureMatchFromAssignment(provision);
    expect(state.match.externalMatchId).toBe('lobby-match-1');
    expect(state.match.lobbyId).toBe('https://joinquest.cc');
    expect(state.match.lobbyReturnUrl).toBe('https://joinquest.cc');
    expect(state.match.lobbyGraphqlUrl).toBe('https://joinquest.cc/graphql');
    expect(state.match.lobbyServiceToken).toBe('lobby-svc-secret');
    const seatA = state.seats.find((s) => s.seatKey === '1');
    expect(seatA?.reservedForLobbyUser).toBe('u_alice');
    expect(state.seats.every((s) => !s.player)).toBe(true);
  });

  it('is idempotent on externalMatchId', async () => {
    const svc = service();
    const first = await svc.ensureMatchFromAssignment(provision);
    const second = await svc.ensureMatchFromAssignment(provision);
    expect(second.match.id).toBe(first.match.id);
  });

  it('rejects a roster containing a banned player (so Lobby can correct)', async () => {
    const svc = service(['u_bob']);
    await expect(svc.ensureMatchFromAssignment(provision)).rejects.toMatchObject({
      bannedLobbyUserIds: ['u_bob'],
    });
    await expect(svc.ensureMatchFromAssignment(provision)).rejects.toBeInstanceOf(BannedPlayerError);
  });

  it('lets the reserved user claim their seat, but not anyone else', async () => {
    const svc = service();
    const state = await svc.ensureMatchFromAssignment(provision);
    const code = state.match.code;

    const claimed = await svc.claimSeat(code, { seatKey: '1', name: 'Alice', lobbyUserId: 'u_alice' });
    expect(claimed.you.seatKey).toBe('1');

    await expect(
      svc.claimSeat(code, { seatKey: '2', name: 'Mallory', lobbyUserId: 'u_mallory' }),
    ).rejects.toBeInstanceOf(ReservationError);
  });

  it('claim is idempotent for the same Lobby user', async () => {
    const svc = service();
    const state = await svc.ensureMatchFromAssignment(provision);
    const code = state.match.code;
    const first = await svc.claimSeat(code, { seatKey: '1', name: 'Alice', lobbyUserId: 'u_alice' });
    const again = await svc.claimSeat(code, { seatKey: '1', name: 'Alice', lobbyUserId: 'u_alice' });
    expect(again.you.playerId).toBe(first.you.playerId);
  });

  it('refuses a token claim when the match was never provisioned', async () => {
    const svc = service();
    await expect(
      svc.assertMatchProvisioned({
        lobbyIssuer: 'https://joinquest.cc',
        lobbyUserId: 'u_alice',
        externalMatchId: 'never-pushed',
        seatKey: '1',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects claim when token iss does not match provisioned lobbyId', async () => {
    const svc = service();
    await svc.ensureMatchFromAssignment(provision);
    await expect(
      svc.assertMatchProvisioned({
        lobbyIssuer: 'https://evil.example',
        lobbyUserId: 'u_alice',
        externalMatchId: 'lobby-match-1',
        seatKey: '1',
      }),
    ).rejects.toMatchObject({ message: /iss/ });
  });
});
