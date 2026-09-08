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

  it('blocks lizard and robot on the opening round (initial cooldown)', async () => {
    const { code, hostId } = await setupMatch();
    await expect(service.submitMove(code, hostId, 'lizard')).rejects.toBeInstanceOf(ValidationError);
    await expect(service.submitMove(code, hostId, 'robot')).rejects.toBeInstanceOf(ValidationError);
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
    // After choosing rock: rock=2, robot=1 (2->1), lizard=0 (1->1... decrement then nothing)
    expect(seatA?.delays.rock).toBe(2);
    expect(seatA?.delays.lizard).toBe(0);
    expect(seatA?.delays.robot).toBe(1);
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

describe('GameService — duel-helpers loadouts', () => {
  let repo: MemoryGameRepository;
  let service: GameService;

  beforeEach(() => {
    repo = new MemoryGameRepository();
    // A fixed source, so the same-move roll is a decision this test can name.
    service = new GameService(repo, { rng: () => 0 });
  });

  function provision(
    externalMatchId: string,
    seats: { seatKey: string; optionIds?: string[] }[],
  ) {
    return service.ensureMatchFromAssignment({
      lobbyId: 'https://lobby.local',
      lobby: { returnUrl: 'http://localhost:5173', graphqlUrl: 'http://localhost:8080/query' },
      assignment: {
        externalMatchId,
        gameMode: 'duel-helpers',
        bestOf: 5,
        seats: seats.map((s) => ({
          seatKey: s.seatKey,
          lobbyUserId: `u_${s.seatKey}`,
          options: s.optionIds ? [{ groupKey: 'helpers', optionIds: s.optionIds }] : undefined,
        })),
      },
    });
  }

  it('stores the loadout each seat was provisioned with', async () => {
    const state = await provision('m-store', [
      { seatKey: '1', optionIds: ['ferrus', 'chimera'] },
      { seatKey: '2', optionIds: ['oracle', 'copycat'] },
    ]);
    expect(state.seats[0].loadout).toEqual(['ferrus', 'chimera']);
    expect(state.seats[1].loadout).toEqual(['oracle', 'copycat']);
  });

  it('opens with the marks the loadouts imply, not the duel opening', async () => {
    const state = await provision('m-marks', [
      { seatKey: '1', optionIds: ['ferrus', 'chimera'] },
      { seatKey: '2', optionIds: ['oracle', 'copycat'] },
    ]);
    // Ferrus binds Robot and Chimera binds Lizard; both are Majors, so 2 marks each.
    expect(state.seats[0].delays).toEqual({ rock: 0, paper: 0, scissors: 0, lizard: 2, robot: 2 });
    // Oracle binds Paper; Copycat is a Trinket and costs nothing.
    expect(state.seats[1].delays).toEqual({ rock: 0, paper: 2, scissors: 0, lizard: 0, robot: 0 });
  });

  it('survives a reload — the loadout is read back, not re-derived', async () => {
    const created = await provision('m-reload', [
      { seatKey: '1', optionIds: ['ferrus', 'chimera'] },
      { seatKey: '2', optionIds: ['oracle', 'copycat'] },
    ]);
    const reread = await service.getState('m-reload');
    expect(reread.seats.map((s) => s.loadout)).toEqual(created.seats.map((s) => s.loadout));
  });

  it('rolls a same-move collision once, and the roll does not move on re-read', async () => {
    // Ferrus and Freeze both bind Robot, so the second one's marks are displaced.
    const created = await provision('m-roll', [
      { seatKey: '1', optionIds: ['ferrus', 'freeze'] },
      { seatKey: '2', optionIds: ['oracle', 'copycat'] },
    ]);
    const rolled = created.seats[0].loadoutRoll;
    expect(rolled).not.toBeNull();
    expect(created.seats[0].delays.robot).toBe(2);
    expect(created.seats[0].delays[rolled!]).toBe(2);

    const reread = await service.getState('m-roll');
    expect(reread.seats[0].loadoutRoll).toBe(rolled);
    expect(reread.seats[0].delays).toEqual(created.seats[0].delays);
  });

  it('defaults a seat that picked nothing to exactly the duel opening', async () => {
    const state = await provision('m-default', [{ seatKey: '1' }, { seatKey: '2' }]);
    for (const seat of state.seats) {
      expect(seat.loadout).toEqual(['ferrus', 'featherweight']);
      expect(seat.delays).toEqual({ rock: 0, paper: 0, scissors: 0, lizard: 1, robot: 2 });
    }
  });

  it('refuses to seat an invalid selection', async () => {
    await expect(
      provision('m-bad', [
        { seatKey: '1', optionIds: ['ferrus', 'ferrus'] },
        { seatKey: '2', optionIds: ['oracle', 'copycat'] },
      ]),
    ).rejects.toMatchObject({ seatKey: '1', reason: 'a loadout needs two different helpers' });
  });

  it('rejects a missing selection when the deploy has tightened', async () => {
    const strict = new GameService(new MemoryGameRepository(), { requirePreQueueOptions: true });
    await expect(
      strict.ensureMatchFromAssignment({
        lobbyId: 'https://lobby.local',
        lobby: { returnUrl: 'http://localhost:5173', graphqlUrl: 'http://localhost:8080/query' },
        assignment: {
          externalMatchId: 'm-strict',
          gameMode: 'duel-helpers',
          bestOf: 5,
          seats: [
            { seatKey: '1', lobbyUserId: 'u_1' },
            { seatKey: '2', lobbyUserId: 'u_2' },
          ],
        },
      }),
    ).rejects.toMatchObject({ seatKey: '1' });
  });

  it('gives a standalone duel-helpers match the default loadout, tightening or not', async () => {
    const strict = new GameService(new MemoryGameRepository(), { requirePreQueueOptions: true });
    const created = await strict.createStandaloneMatch({
      gameMode: 'duel-helpers',
      hostName: 'Alice',
    });
    expect(created.state.seats[0].loadout).toEqual(['ferrus', 'featherweight']);
  });

  it('leaves a duel seat with no loadout at all', async () => {
    const created = await service.createStandaloneMatch({ hostName: 'Alice' });
    expect(created.state.seats[0].loadout).toBeNull();
    expect(created.state.seats[0].loadoutRoll).toBeNull();
  });
});

describe('GameService — ability firings', () => {
  let repo: MemoryGameRepository;
  let service: GameService;

  beforeEach(() => {
    repo = new MemoryGameRepository();
    service = new GameService(repo);
  });

  async function playingMatch() {
    const created = await service.createStandaloneMatch({
      gameMode: 'duel-helpers',
      hostName: 'Alice',
      bestOf: 3,
    });
    const code = created.state.match.code;
    const joined = await service.claimSeat(code, { seatKey: '2', name: 'Bob' });
    const state = await service.getState(code);
    return {
      code,
      matchId: state.match.id,
      seatId: state.seats[0].id,
      hostId: created.you.playerId,
      challengerId: joined.you.playerId,
    };
  }

  it('withholds a firing from the round still being played', async () => {
    const { code, matchId, seatId } = await playingMatch();
    await repo.recordAbilityFiring({
      matchId,
      seatId,
      round: 1,
      helperId: 'quarantine',
      target: 'rock',
    });

    const state = await service.getState(code);
    expect(state.abilityFirings).toEqual([]);
    // The named move must not be anywhere in the payload, not merely unrendered.
    expect(JSON.stringify(state)).not.toContain('quarantine');
  });

  it('discloses the firing, and the move it named, once the round resolves', async () => {
    const { code, matchId, seatId, hostId, challengerId } = await playingMatch();
    await repo.recordAbilityFiring({
      matchId,
      seatId,
      round: 1,
      helperId: 'quarantine',
      target: 'rock',
    });

    await service.submitMove(code, hostId, 'paper');
    await service.submitMove(code, challengerId, 'scissors');

    const state = await service.getState(code);
    expect(state.abilityFirings).toEqual([
      { round: 1, seatKey: '1', helperId: 'quarantine', target: 'rock' },
    ]);
  });

  it('refuses a second firing from the same seat in the same round', async () => {
    const { matchId, seatId } = await playingMatch();
    const firing = { matchId, seatId, round: 1, helperId: 'rust', target: null };
    await repo.recordAbilityFiring(firing);
    await expect(repo.recordAbilityFiring(firing)).rejects.toBeInstanceOf(ConflictError);
  });

  it('survives a reload — a spent charge is not handed back', async () => {
    const { matchId, seatId } = await playingMatch();
    await repo.recordAbilityFiring({
      matchId,
      seatId,
      round: 1,
      helperId: 'freeze',
      target: null,
    });
    expect(await repo.listAbilityFirings(matchId)).toEqual([
      { round: 1, seatKey: '1', helperId: 'freeze', target: null },
    ]);
  });
});
