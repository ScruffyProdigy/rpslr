import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryGameRepository } from './memoryRepository.js';
import { BannedPlayerError, GameService, ValidationError } from './service.js';
import { ConflictError, NotFoundError, ReservationError } from './repository.js';
import type { Move } from './game.js';

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

  it('ends a match of nothing but draws at the round cap', async () => {
    // best-of-3 caps at 6. Mirrored picks draw every round and leave both
    // players on identical cooldowns, so the cycle stays legal indefinitely —
    // which is exactly the match that used to run forever.
    const { code, hostId, challengerId } = await setupMatch(3);
    const cycle: Move[] = ['rock', 'paper', 'scissors'];
    let state = await service.getState(code);
    for (let i = 0; i < 6; i++) {
      const move = cycle[i % cycle.length];
      await service.submitMove(code, hostId, move);
      state = await service.submitMove(code, challengerId, move);
    }
    expect(state.results).toHaveLength(6);
    expect(state.results.every((r) => r.outcome === 'draw')).toBe(true);
    expect(state.match.status).toBe('finished');
    expect(state.matchWinnerSeatKey).toBeNull();
    expect(state.match.endReason).toBe('draw');
  });

  it('awards a capped match to whoever is ahead on score', async () => {
    const { code, hostId, challengerId } = await setupMatch(3);
    const cycle: Move[] = ['rock', 'paper', 'scissors'];
    let state = await service.getState(code);
    for (let i = 0; i < 5; i++) {
      const move = cycle[i % cycle.length];
      await service.submitMove(code, hostId, move);
      state = await service.submitMove(code, challengerId, move);
    }
    // Round 6 is the cap. One win short of the best-of-3 threshold still takes
    // the match, because there is no round 7 to take it in.
    await service.submitMove(code, hostId, 'scissors');
    state = await service.submitMove(code, challengerId, 'lizard');
    expect(state.match.status).toBe('finished');
    expect(state.matchWinnerSeatKey).toBe('1');
    expect(state.match.endReason).toBe('played');
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

  it('reports a capped draw to Lobby as a completed match with no winner', async () => {
    // The one terminating case with no winning seat. Lobby's lifecycle mutation
    // already takes an empty winner list (that is how `abandoned` reports), so
    // this pins that a declared draw travels the same road rather than sending
    // Lobby a winner it does not have.
    const calls: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
      if (init?.body) calls.push(init.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { reportMatchResult: true } }),
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const svc = service();
      const state = await svc.ensureMatchFromAssignment({
        ...provision,
        assignment: { ...provision.assignment, bestOf: 3 },
      });
      const code = state.match.code;
      const alice = await svc.claimSeat(code, { seatKey: '1', name: 'Alice', lobbyUserId: 'u_alice' });
      const bob = await svc.claimSeat(code, { seatKey: '2', name: 'Bob', lobbyUserId: 'u_bob' });

      const cycle: Move[] = ['rock', 'paper', 'scissors'];
      let played = await svc.getState(code);
      for (let i = 0; i < 6; i++) {
        const move = cycle[i % cycle.length];
        await svc.submitMove(code, alice.you.playerId, move);
        played = await svc.submitMove(code, bob.you.playerId, move);
      }
      expect(played.match.endReason).toBe('draw');

      await vi.waitFor(() => {
        expect(calls.some((b) => b.includes('reportMatchResult'))).toBe(true);
      });
      const report = JSON.parse(calls.find((b) => b.includes('reportMatchResult'))!);
      expect(report.variables.status).toBe('COMPLETED');
      expect(report.variables.winnerLobbyUserIds).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
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

  it('refuses to seat a player who picked nothing', async () => {
    await expect(provision('m-default', [{ seatKey: '1' }, { seatKey: '2' }])).rejects.toMatchObject(
      { seatKey: '1', reason: expect.stringContaining('pre-queue selection is required') },
    );
  });

  it('refuses to seat an invalid selection', async () => {
    await expect(
      provision('m-bad', [
        { seatKey: '1', optionIds: ['ferrus', 'ferrus'] },
        { seatKey: '2', optionIds: ['oracle', 'copycat'] },
      ]),
    ).rejects.toMatchObject({ seatKey: '1', reason: 'a loadout needs two different helpers' });
  });

  it('seats a standalone duel-helpers match from the loadouts it was given', async () => {
    const created = await service.createStandaloneMatch({
      gameMode: 'duel-helpers',
      hostName: 'Alice',
      seats: [
        { seatKey: '1', options: [{ groupKey: 'helpers', optionIds: ['ferrus', 'chimera'] }] },
        { seatKey: '2', options: [{ groupKey: 'helpers', optionIds: ['oracle', 'copycat'] }] },
      ],
    });
    expect(created.state.seats[0].loadout).toEqual(['ferrus', 'chimera']);
    expect(created.state.seats[1].loadout).toEqual(['oracle', 'copycat']);
  });

  it('refuses a standalone duel-helpers match that names no loadout', async () => {
    await expect(
      service.createStandaloneMatch({ gameMode: 'duel-helpers', hostName: 'Alice' }),
    ).rejects.toMatchObject({ seatKey: '1' });
  });

  it('caps a duel-helpers match too — the gap is in the base game', async () => {
    // Two purely informational Trinkets, so nothing here changes how a mirror
    // resolves; the only thing under test is that helpers mode reaches the cap.
    const created = await service.createStandaloneMatch({
      gameMode: 'duel-helpers',
      hostName: 'Alice',
      bestOf: 3,
      seats: [
        { seatKey: '1', options: [{ groupKey: 'helpers', optionIds: ['poker-face', 'old-habits'] }] },
        { seatKey: '2', options: [{ groupKey: 'helpers', optionIds: ['poker-face', 'old-habits'] }] },
      ],
    });
    const code = created.state.match.code;
    const hostId = created.you.playerId;
    const joined = await service.claimSeat(code, { seatKey: '2', name: 'Bob' });
    const cycle: Move[] = ['rock', 'paper', 'scissors'];
    let state = await service.getState(code);
    for (let i = 0; i < 6; i++) {
      const move = cycle[i % cycle.length];
      await service.submitMove(code, hostId, move);
      state = await service.submitMove(code, joined.you.playerId, move);
    }
    expect(state.match.status).toBe('finished');
    expect(state.matchWinnerSeatKey).toBeNull();
    expect(state.match.endReason).toBe('draw');
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
      seats: [
        { seatKey: '1', options: [{ groupKey: 'helpers', optionIds: ['quarantine', 'copycat'] }] },
        { seatKey: '2', options: [{ groupKey: 'helpers', optionIds: ['oracle', 'watchful'] }] },
      ],
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
    // Rust is the secret exemplar since JQ-209 made Quarantine public. Any card with
    // a target and `reveal: 'secret'` does this job; Quarantine no longer can.
    const { code, matchId, seatId } = await playingMatch();
    await repo.recordAbilityFiring({
      matchId,
      seatId,
      round: 1,
      helperId: 'rust',
      target: 'rock',
      source: null,
    });

    const state = await service.getState(code);
    expect(state.abilityFirings).toEqual([]);
    // The named move must be absent from the payload, not merely unrendered. Holding
    // Quarantine is public — naming a move with it is not until the round is over.
    expect(JSON.stringify(state)).not.toContain('"target"');
  });

  it('discloses the firing, and the move it named, once the round resolves', async () => {
    const { code, matchId, seatId, hostId, challengerId } = await playingMatch();
    await repo.recordAbilityFiring({
      matchId,
      seatId,
      round: 1,
      helperId: 'quarantine',
      target: 'rock',
      source: null,
    });

    await service.submitMove(code, hostId, 'paper');
    await service.submitMove(code, challengerId, 'scissors');

    const state = await service.getState(code);
    expect(state.abilityFirings).toEqual([
      { round: 1, seatKey: '1', helperId: 'quarantine', target: 'rock', source: null },
    ]);
  });

  it('charges the marks a fired ability landed to the seat it landed on', async () => {
    // Quarantine names Rock; the other seat plays Rock into it. A firing is the one
    // thing a board cannot be replayed without, so a state that ignored it would
    // hand that player their move back two rounds early.
    const { code, matchId, seatId, hostId, challengerId } = await playingMatch();
    await repo.recordAbilityFiring({
      matchId,
      seatId,
      round: 1,
      helperId: 'quarantine',
      target: 'rock',
      source: null,
    });

    await service.submitMove(code, hostId, 'paper');
    await service.submitMove(code, challengerId, 'rock');
    // Quarantine fires in public since JQ-209, so the seat it names is handed the
    // round's window. Standing on Rock is what walks into the marks — which is the
    // point of the card being answerable: the marks land on a choice, not a guess.
    await service.submitMove(code, challengerId, 'rock');

    const state = await service.getState(code);
    const challengerSeat = state.seats.find((s) => s.seatKey === '2')!;
    expect(challengerSeat.delays.rock).toBe(4);
  });

  it('refuses a second firing from the same seat in the same round', async () => {
    const { matchId, seatId } = await playingMatch();
    const firing = { matchId, seatId, round: 1, helperId: 'rust', target: null, source: null };
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
      source: null,
});
    expect(await repo.listAbilityFirings(matchId)).toEqual([
      { round: 1, seatKey: '1', helperId: 'freeze', target: null, source: null },
    ]);
  });
});

/**
 * JQ-220: the path from a player's decision to the round it changes.
 *
 * The loadouts here pair each ability with Poker Face, which binds no move and
 * prices no round, so every delay number below is the ability's doing and not a
 * partner card's. Copycat would have re-priced draws and made the arithmetic
 * argue two things at once.
 */
describe('GameService — firing an ability', () => {
  let repo: MemoryGameRepository;
  let service: GameService;

  beforeEach(() => {
    repo = new MemoryGameRepository();
    service = new GameService(repo, { rng: () => 0 });
  });

  async function helpersMatch(one: string[], two: string[], bestOf = 5) {
    const created = await service.createStandaloneMatch({
      gameMode: 'duel-helpers',
      hostName: 'Alice',
      bestOf,
      seats: [
        { seatKey: '1', options: [{ groupKey: 'helpers', optionIds: one }] },
        { seatKey: '2', options: [{ groupKey: 'helpers', optionIds: two }] },
      ],
    });
    const joined = await service.claimSeat(created.state.match.code, {
      seatKey: '2',
      name: 'Bob',
    });
    return {
      code: created.state.match.code,
      alice: created.you.playerId,
      bob: joined.you.playerId,
    };
  }

  /** Both moves of one round, in the order that resolves it. */
  async function playRound(code: string, alice: string, a: string, bob: string, b: string) {
    await service.submitMove(code, alice, a);
    return service.submitMove(code, bob, b);
  }

  it('lets a seat fire for the round it is playing, and reports its own charge', async () => {
    const { code, alice } = await helpersMatch(['freeze', 'poker-face'], ['rust', 'poker-face']);

    const before = await service.getState(code, alice);
    expect(before.abilities).toEqual({ freeze: { marks: 0, available: true } });

    const after = await service.fireAbility(code, alice, { helperId: 'freeze' });
    // The charge is spent the moment it is fired, before the round resolves — the
    // recharge itself lands with the round, so `marks` has not moved yet.
    expect(after.abilities).toEqual({ freeze: { marks: 0, available: false } });
  });

  it('is the only source of truth on reconnect — no charge state lives in the process', async () => {
    const { code, alice } = await helpersMatch(['freeze', 'poker-face'], ['rust', 'poker-face']);
    await service.fireAbility(code, alice, { helperId: 'freeze' });

    // A brand-new service over the same rows: anything held in memory is gone.
    const restarted = new GameService(repo, { rng: () => 0 });
    const state = await restarted.getState(code, alice);
    expect(state.abilities.freeze).toEqual({ marks: 0, available: false });
  });

  it('refuses an ability the seat does not hold', async () => {
    const { code, alice } = await helpersMatch(['freeze', 'poker-face'], ['rust', 'poker-face']);
    await expect(service.fireAbility(code, alice, { helperId: 'rust' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('refuses a charge that is not yet available', async () => {
    // Sacrifice opens on 3 marks, so round 1 is three rounds too early.
    const { code, alice } = await helpersMatch(['sacrifice', 'poker-face'], ['rust', 'poker-face']);
    await expect(
      service.fireAbility(code, alice, { helperId: 'sacrifice' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses a second firing in the same round', async () => {
    const { code, alice } = await helpersMatch(['freeze', 'poker-face'], ['rust', 'poker-face']);
    await service.fireAbility(code, alice, { helperId: 'freeze' });
    await expect(service.fireAbility(code, alice, { helperId: 'freeze' })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('holds each ability to the target it actually names', async () => {
    // Alice: Thief (binds lizard, so her lizard opens on 2). Bob: Rust (scissors).
    const { code, alice } = await helpersMatch(['thief', 'poker-face'], ['rust', 'poker-face']);

    // Sacrifice and Freeze name nothing; a target offered anyway is refused rather
    // than stored and ignored.
    await expect(
      service.fireAbility(code, alice, { helperId: 'thief', target: 'not-a-move', source: 'lizard' }),
    ).rejects.toBeInstanceOf(ValidationError);
    // Thief takes from a mark of its owner's, so a clear source is not a firing.
    await expect(
      service.fireAbility(code, alice, { helperId: 'thief', target: 'scissors', source: 'rock' }),
    ).rejects.toThrow(/needs a mark of your own/);
    // ...and it needs both ends named.
    await expect(
      service.fireAbility(code, alice, { helperId: 'thief', target: 'scissors' }),
    ).rejects.toThrow(/one of your moves/);
  });

  it('refuses Rust against a move the opponent has clear', async () => {
    // Bob holds Thief, which binds lizard: lizard is his only move on cooldown.
    const { code, alice } = await helpersMatch(['rust', 'poker-face'], ['thief', 'poker-face']);
    await expect(
      service.fireAbility(code, alice, { helperId: 'rust', target: 'rock' }),
    ).rejects.toThrow(/on cooldown/);
    await expect(
      service.fireAbility(code, alice, { helperId: 'rust', target: 'lizard' }),
    ).resolves.toBeTruthy();
  });

  it('lets Quarantine name any move, because it is fired blind', async () => {
    const { code, alice } = await helpersMatch(
      ['quarantine', 'poker-face'],
      ['rust', 'poker-face'],
    );
    // Rock is clear for Bob and stays a legal guess — missing is the card's price.
    const state = await service.fireAbility(code, alice, { helperId: 'quarantine', target: 'rock' });
    expect(state.abilities.quarantine.available).toBe(false);
  });

  it('refuses a target for an ability that names none', async () => {
    const { code, alice } = await helpersMatch(['freeze', 'poker-face'], ['rust', 'poker-face']);
    await expect(
      service.fireAbility(code, alice, { helperId: 'freeze', target: 'rock' }),
    ).rejects.toThrow(/takes no target/);
  });

  it('refuses a client-supplied target for Oracle — the server names that move, later', async () => {
    const { code, alice } = await helpersMatch(['oracle', 'poker-face'], ['rust', 'poker-face']);
    await expect(
      service.fireAbility(code, alice, { helperId: 'oracle', target: 'rock' }),
    ).rejects.toThrow(/takes no target/);
  });

  it('carries the firing into resolution — Rust deepens the cooldown it named', async () => {
    // Alice: Rust (binds scissors → her scissors opens on 2).
    // Bob: Thief (binds lizard → his lizard opens on 2, which is what Rust can reach).
    const { code, alice, bob } = await helpersMatch(
      ['rust', 'poker-face'],
      ['thief', 'poker-face'],
    );
    await service.fireAbility(code, alice, { helperId: 'rust', target: 'lizard' });
    const state = await playRound(code, alice, 'rock', bob, 'paper');

    expect(state.results[0].outcome).toBe('2');
    // Bob's lizard: 2 entering, decremented to 1, then Rust's 1 on top.
    expect(state.seats[1].delays).toEqual({ rock: 0, paper: 2, scissors: 0, lizard: 2, robot: 0 });
    expect(state.seats[0].delays).toEqual({ rock: 2, paper: 0, scissors: 1, lizard: 0, robot: 0 });
  });

  it('moves a mark rather than adding one, when the firing is Thief', async () => {
    const { code, alice, bob } = await helpersMatch(
      ['thief', 'poker-face'],
      ['rust', 'poker-face'],
    );
    await service.fireAbility(code, alice, {
      helperId: 'thief',
      source: 'lizard',
      target: 'scissors',
    });
    const state = await playRound(code, alice, 'rock', bob, 'paper');

    // Alice's own lizard mark is lifted (2 → 1 by decay, then −1); Bob's scissors
    // takes it (2 → 1 by decay, then +1).
    expect(state.seats[0].delays).toEqual({ rock: 2, paper: 0, scissors: 0, lizard: 0, robot: 0 });
    expect(state.seats[1].delays).toEqual({ rock: 0, paper: 2, scissors: 2, lizard: 0, robot: 0 });
  });

  it('replays a firing from an earlier round — Freeze stops the decay it was fired against', async () => {
    const { code, alice, bob } = await helpersMatch(
      ['freeze', 'poker-face'],
      ['rust', 'poker-face'],
    );
    await playRound(code, alice, 'rock', bob, 'paper');

    await service.fireAbility(code, alice, { helperId: 'freeze' });
    // Freeze fires in public since JQ-209, so Bob is handed the round's sub-phase to
    // answer it. He stands on the pick he already made; the round resolves on that.
    await service.submitMove(code, alice, 'paper');
    await service.submitMove(code, bob, 'rock');
    const state = await service.submitMove(code, bob, 'rock');

    // Bob's marks did not come off this round: scissors held at 1 and paper at 2,
    // where an unfrozen round would have left 0 and 1.
    expect(state.seats[1].delays).toEqual({ rock: 2, paper: 2, scissors: 1, lizard: 0, robot: 0 });
    expect(state.seats[0].delays).toEqual({ rock: 1, paper: 2, scissors: 0, lizard: 0, robot: 0 });
    // Read as Alice: `playRound` returns Bob's view, because Bob moved last — which
    // is the projection doing its job. The recharge landed with the round rather
    // than at firing time.
    expect(state.abilities).toEqual({ rust: { marks: 0, available: true } });
    const asAlice = await service.getState(code, alice);
    // `recharge: null` is once per match, so a fired Freeze never comes back.
    expect(asAlice.abilities).toEqual({ freeze: { marks: null, available: false } });
  });

  it("resolves a Sacrificed round as a draw and clears only the firing seat's marks", async () => {
    const { code, alice, bob } = await helpersMatch(
      ['sacrifice', 'poker-face'],
      ['freeze', 'poker-face'],
    );
    // Three drawn rounds bring Sacrifice's opening 3 marks down to 0.
    await playRound(code, alice, 'paper', bob, 'paper');
    await playRound(code, alice, 'scissors', bob, 'scissors');
    await playRound(code, alice, 'lizard', bob, 'lizard');
    expect((await service.getState(code, alice)).abilities.sacrifice).toEqual({
      marks: 0,
      available: true,
    });

    await service.fireAbility(code, alice, { helperId: 'sacrifice' });
    // Paper beats rock, so this round had a winner in it — Sacrifice replaces it.
    const state = await playRound(code, alice, 'rock', bob, 'paper');

    expect(state.results[3].outcome).toBe('draw');
    expect(state.seats.map((s) => s.player!.score)).toEqual([0, 0]);
    // Alice's board is wiped, then her own move takes its cost. Bob keeps his lizard.
    expect(state.seats[0].delays).toEqual({ rock: 2, paper: 0, scissors: 0, lizard: 0, robot: 0 });
    expect(state.seats[1].delays).toEqual({ rock: 0, paper: 2, scissors: 0, lizard: 1, robot: 0 });
  });

  it('withholds an unresolved firing from the state, and discloses it once the round resolves', async () => {
    // The seats are the other way round since JQ-209: Alice holds the secret card,
    // because a fired Quarantine is disclosed at once now and would not be withheld.
    const { code, alice, bob } = await helpersMatch(
      ['rust', 'poker-face'],
      ['quarantine', 'poker-face'],
    );
    await service.fireAbility(code, alice, { helperId: 'rust', target: 'scissors' });

    const midRound = await service.getState(code, bob);
    expect(midRound.abilityFirings).toEqual([]);
    // Bob is told about his own charge and nothing about Alice's.
    expect(Object.keys(midRound.abilities)).toEqual(['quarantine']);

    // Both hold a scissors-binding Major, so both open with scissors on cooldown.
    const resolved = await playRound(code, alice, 'rock', bob, 'rock');
    expect(resolved.abilityFirings).toEqual([
      { round: 1, seatKey: '1', helperId: 'rust', target: 'scissors', source: null },
    ]);
  });
});

/**
 * JQ-238: one firing per ability *slot* per round, not one per seat.
 *
 * A seat used to be capped at one firing whatever its loadout held, which quietly
 * made a second charge card worth a fraction of its standalone value — and
 * double-charged, since the tier ladder already taxes Major + Major on tempo. The
 * engine was always plural; only the service check and the unique index were not.
 *
 * Alice brings Rust (binds scissors) and Thief (binds lizard) — two charge cards,
 * two slots, and no collision roll to store. Bob brings Quarantine, which binds
 * scissors, so he has the cooldown Rust needs to deepen.
 */
describe('GameService — two charged abilities in one round', () => {
  let repo: MemoryGameRepository;
  let service: GameService;

  beforeEach(() => {
    repo = new MemoryGameRepository();
    service = new GameService(repo, { rng: () => 0 });
  });

  async function twoChargeMatch(alice = ['rust', 'thief'], bob = ['quarantine', 'poker-face']) {
    const created = await service.createStandaloneMatch({
      gameMode: 'duel-helpers',
      hostName: 'Alice',
      bestOf: 5,
      seats: [
        { seatKey: '1', options: [{ groupKey: 'helpers', optionIds: alice }] },
        { seatKey: '2', options: [{ groupKey: 'helpers', optionIds: bob }] },
      ],
    });
    const joined = await service.claimSeat(created.state.match.code, {
      seatKey: '2',
      name: 'Bob',
    });
    return {
      code: created.state.match.code,
      alice: created.you.playerId,
      bob: joined.you.playerId,
    };
  }

  it('spends one slot and leaves the other charged', async () => {
    const { code, alice } = await twoChargeMatch();

    const before = await service.getState(code, alice);
    expect(before.abilities).toEqual({
      rust: { marks: 0, available: true },
      thief: { marks: 0, available: true },
    });

    const after = await service.fireAbility(code, alice, { helperId: 'rust', target: 'scissors' });
    // Firing Rust says nothing about Thief. One-per-seat used to make it say
    // everything: the second card was dead for the round the moment the first fired.
    expect(after.abilities).toEqual({
      rust: { marks: 0, available: false },
      thief: { marks: 0, available: true },
    });
  });

  it('fires both in one round, and the round takes both', async () => {
    const { code, alice, bob } = await twoChargeMatch();
    await service.fireAbility(code, alice, { helperId: 'rust', target: 'scissors' });
    await service.fireAbility(code, alice, {
      helperId: 'thief',
      source: 'lizard',
      target: 'scissors',
    });

    await service.submitMove(code, alice, 'rock');
    const state = await service.submitMove(code, bob, 'rock');

    // Bob's scissors: 2 entering, 1 after the decrement, +1 from Rust and +1 from
    // Thief. Two marks from one round, which is the point of bringing two cards.
    expect(state.seats[1].delays).toEqual({ rock: 2, paper: 0, scissors: 3, lizard: 0, robot: 0 });
    // Thief's own half landed too: Alice's lizard went 2 → 1 → 0.
    expect(state.seats[0].delays).toEqual({ rock: 2, paper: 0, scissors: 1, lizard: 0, robot: 0 });
    // Both charges are spent, each on its own recharge — which JQ-209 made a real
    // distinction rather than two cards reading 3. Rust comes back on 4, Thief on 6,
    // so a seat holding both desyncs after the first double round.
    expect((await service.getState(code, alice)).abilities).toEqual({
      rust: { marks: 4, available: false },
      thief: { marks: 6, available: false },
    });
  });

  it('discloses both firings once the round resolves', async () => {
    const { code, alice, bob } = await twoChargeMatch();
    await service.fireAbility(code, alice, { helperId: 'rust', target: 'scissors' });
    await service.fireAbility(code, alice, {
      helperId: 'thief',
      source: 'lizard',
      target: 'scissors',
    });
    await service.submitMove(code, alice, 'rock');
    const state = await service.submitMove(code, bob, 'rock');

    expect(state.abilityFirings).toEqual([
      { round: 1, seatKey: '1', helperId: 'rust', target: 'scissors', source: null },
      { round: 1, seatKey: '1', helperId: 'thief', target: 'scissors', source: 'lizard' },
    ]);
  });

  it('still refuses the same ability twice in one round', async () => {
    const { code, alice } = await twoChargeMatch();
    await service.fireAbility(code, alice, { helperId: 'rust', target: 'scissors' });
    await expect(
      service.fireAbility(code, alice, { helperId: 'rust', target: 'scissors' }),
    ).rejects.toThrow(/already fired 'rust'/);
  });

  it('leaves the opponent one firing each, not one between them', async () => {
    // The rule is per seat per slot, so Bob's Quarantine is untouched by whatever
    // Alice spends.
    const { code, alice, bob } = await twoChargeMatch();
    await service.fireAbility(code, alice, { helperId: 'rust', target: 'scissors' });
    await expect(
      service.fireAbility(code, bob, { helperId: 'quarantine', target: 'rock' }),
    ).resolves.toBeTruthy();
  });
});

/**
 * The database, not the in-process check, is the authority on a double-spend: two
 * taps racing through two connections both pass the check, and only one insert
 * survives. Narrowing the key to include the helper had to keep that guarantee at
 * the new granularity rather than trade it away for the new rule.
 */
describe('MemoryGameRepository — the double-spend guard', () => {
  let repo: MemoryGameRepository;

  beforeEach(() => {
    repo = new MemoryGameRepository();
  });

  async function seat() {
    const match = await repo.createMatch({
      code: 'RPS-AAAA',
      name: 'm',
      gameMode: 'duel-helpers',
      bestOf: 5,
      seats: [
        { seatKey: '1', position: 0, loadout: ['rust', 'thief'] },
        { seatKey: '2', position: 1, loadout: ['quarantine', 'poker-face'] },
      ],
    });
    const seats = await repo.listSeats(match.id);
    return { matchId: match.id, seatId: seats[0].id, otherSeatId: seats[1].id };
  }

  it('takes two different abilities from one seat in one round', async () => {
    const { matchId, seatId } = await seat();
    const base = { matchId, seatId, round: 1, target: null, source: null };
    await repo.recordAbilityFiring({ ...base, helperId: 'rust' });
    await expect(
      repo.recordAbilityFiring({ ...base, helperId: 'thief' }),
    ).resolves.toBeUndefined();
    expect(await repo.listAbilityFirings(matchId)).toHaveLength(2);
  });

  it('refuses the same ability twice in one round', async () => {
    const { matchId, seatId } = await seat();
    const firing = { matchId, seatId, round: 1, helperId: 'rust', target: null, source: null };
    await repo.recordAbilityFiring(firing);
    await expect(repo.recordAbilityFiring(firing)).rejects.toBeInstanceOf(ConflictError);
  });

  it('lets the same ability fire again in a later round', async () => {
    const { matchId, seatId } = await seat();
    const base = { matchId, seatId, helperId: 'rust', target: null, source: null };
    await repo.recordAbilityFiring({ ...base, round: 1 });
    await expect(repo.recordAbilityFiring({ ...base, round: 2 })).resolves.toBeUndefined();
  });

  it('keeps the key per seat — the other seat may fire the same ability', async () => {
    const { matchId, seatId, otherSeatId } = await seat();
    const base = { matchId, round: 1, helperId: 'rust', target: null, source: null };
    await repo.recordAbilityFiring({ ...base, seatId });
    await expect(
      repo.recordAbilityFiring({ ...base, seatId: otherSeatId }),
    ).resolves.toBeUndefined();
  });

  it('names the target of the firing it was asked for, not whichever came first', async () => {
    // Oracle's write-once draw is keyed by helper now. Without that it could land
    // on a sibling firing, and the holder would read someone else's move back.
    const { matchId, seatId } = await seat();
    const base = { matchId, seatId, round: 1, target: null, source: null };
    await repo.recordAbilityFiring({ ...base, helperId: 'freeze' });
    await repo.recordAbilityFiring({ ...base, helperId: 'oracle' });

    expect(
      await repo.nameAbilityFiringTarget({
        matchId,
        seatId,
        round: 1,
        helperId: 'oracle',
        target: 'paper',
      }),
    ).toBe(true);
    // Write-once: a second call reads false and leaves the stored move alone.
    expect(
      await repo.nameAbilityFiringTarget({
        matchId,
        seatId,
        round: 1,
        helperId: 'oracle',
        target: 'lizard',
      }),
    ).toBe(false);

    const firings = await repo.listAbilityFirings(matchId);
    expect(firings.find((f) => f.helperId === 'oracle')!.target).toBe('paper');
    expect(firings.find((f) => f.helperId === 'freeze')!.target).toBeNull();
  });
});

describe('GameService — a round nobody fired in', () => {
  it('auto-picks at the deadline and leaves the charge unspent', async () => {
    const repo = new MemoryGameRepository();
    let now = Date.parse('2026-01-01T00:00:00.000Z');
    const service = new GameService(repo, { now: () => now, rng: () => 0 });

    const created = await service.createStandaloneMatch({
      gameMode: 'duel-helpers',
      hostName: 'Alice',
      bestOf: 5,
      seats: [
        { seatKey: '1', options: [{ groupKey: 'helpers', optionIds: ['freeze', 'poker-face'] }] },
        { seatKey: '2', options: [{ groupKey: 'helpers', optionIds: ['rust', 'poker-face'] }] },
      ],
    });
    const code = created.state.match.code;
    const alice = created.you.playerId;
    const joined = await service.claimSeat(code, { seatKey: '2', name: 'Bob' });

    await service.submitMove(code, alice, 'rock');
    // Bob never answers; the deadline settles the round for him.
    now = Date.parse(created.state.match.phaseDeadline ?? '2026-01-01T00:01:00.000Z') + 60_000;
    const state = await service.getState(code, alice);

    expect(state.results).toHaveLength(1);
    expect(state.results[0].autoPicked).toEqual([joined.you.playerId]);
    expect(state.abilityFirings).toEqual([]);
    // A round played for you spends nothing: Freeze took its mark off and is now live.
    expect(state.abilities).toEqual({ freeze: { marks: 0, available: true } });
  });
});

/**
 * Oracle's mid-round sub-phase (JQ-150), reached through JQ-239's general path.
 *
 * The protocol: the holder declares Oracle during the pick phase, both players
 * lock in, and the round then stops rather than resolving. The holder is told one
 * live move the opponent did *not* play, re-picks or keeps, and the round
 * resolves. Everything an opponent could exploit is either withheld until the
 * round resolves or never sent at all.
 *
 * Every assertion below is JQ-150's; only the names moved, because the payload
 * stopped being Oracle-shaped. Oracle reaches the window as one member of a class
 * rather than by being named in the service, and behaves identically doing so.
 */
describe('GameService — Oracle', () => {
  let repo: MemoryGameRepository;
  let service: GameService;
  let now: number;

  /** The one reveal Oracle puts in the entitlement, for assertions that want it. */
  const revealed = (state: { entitlement: { reveals: { namedMove: Move | null }[] } | null }) =>
    state.entitlement!.reveals[0];

  /**
   * Alice holds Oracle (binds paper, so her paper opens on 2 marks and is the one
   * move she may not re-pick). Bob holds Rust (binds scissors), so his live moves
   * entering round 1 are rock, paper, lizard and robot — four, of which Oracle
   * names one that is not the move he played.
   */
  async function oracleMatch(bob: string[] = ['rust', 'poker-face']) {
    const created = await service.createStandaloneMatch({
      gameMode: 'duel-helpers',
      hostName: 'Alice',
      bestOf: 5,
      seats: [
        { seatKey: '1', options: [{ groupKey: 'helpers', optionIds: ['oracle', 'poker-face'] }] },
        { seatKey: '2', options: [{ groupKey: 'helpers', optionIds: bob }] },
      ],
    });
    const joined = await service.claimSeat(created.state.match.code, {
      seatKey: '2',
      name: 'Bob',
    });
    return {
      code: created.state.match.code,
      alice: created.you.playerId,
      bob: joined.you.playerId,
    };
  }

  /** Fire Oracle and lock both players in, leaving the round in the sub-phase. */
  async function intoSubPhase(aliceMove = 'rock', bobMove = 'rock') {
    const m = await oracleMatch();
    await service.fireAbility(m.code, m.alice, { helperId: 'oracle' });
    await service.submitMove(m.code, m.alice, aliceMove);
    await service.submitMove(m.code, m.bob, bobMove);
    return m;
  }

  beforeEach(() => {
    repo = new MemoryGameRepository();
    now = Date.parse('2026-01-01T00:00:00.000Z');
    // rng() === 0 takes the first candidate, so the named move is exact.
    service = new GameService(repo, { now: () => now, rng: () => 0 });
  });

  it('holds the round between both-locked and resolve', async () => {
    const { code, alice, bob } = await oracleMatch();
    await service.fireAbility(code, alice, { helperId: 'oracle' });

    // One lock-in is not both: the round is still an ordinary pick phase.
    await service.submitMove(code, alice, 'rock');
    let state = await service.getState(code, alice);
    expect(state.match.phase).toBe('pick');

    await service.submitMove(code, bob, 'rock');
    state = await service.getState(code, alice);
    expect(state.match.phase).toBe('react');
    // Held, not resolved: the round has not scored and has not moved on.
    expect(state.results).toEqual([]);
    expect(state.match.currentRound).toBe(1);
  });

  it('puts the sub-phase on a clock of its own', async () => {
    const { code, alice } = await intoSubPhase();
    const state = await service.getState(code, alice);
    expect(Date.parse(state.match.phaseStartedAt!)).toBe(now);
    expect(Date.parse(state.match.phaseDeadline!)).toBe(now + 12_000);
  });

  it('names a live move the opponent did not play, to the holder alone', async () => {
    const { code, alice, bob } = await intoSubPhase('rock', 'rock');

    // Bob's live moves are rock, paper, lizard, robot; he played rock, so the
    // first candidate is paper.
    const hers = await service.getState(code, alice);
    expect(hers.entitlement).toEqual({
      round: 1,
      reveals: [{ helperId: 'oracle', namedMove: 'paper' }],
      incoming: [],
      acted: false,
    });

    // Bob is told nothing at all — not the reveal, and not that one is running.
    // Oracle is a secret firing, so it gives him no claim on the window either.
    const his = await service.getState(code, bob);
    expect(his.entitlement).toBeNull();
  });

  it('never names the move they actually played, whichever way the draw falls', async () => {
    // Every rng value in turn, against every move Bob might have played: the
    // named move must never be his. This is the property the card rests on.
    for (const bobMove of ['rock', 'paper', 'lizard', 'robot']) {
      for (const r of [0, 0.25, 0.5, 0.75, 0.99]) {
        repo = new MemoryGameRepository();
        service = new GameService(repo, { now: () => now, rng: () => r });
        const { code, alice } = await intoSubPhase('rock', bobMove);
        const state = await service.getState(code, alice);
        expect(revealed(state).namedMove, `${bobMove} @ ${r}`).not.toBe(bobMove);
        // Scissors is on cooldown for Bob, so it was never a move he could play.
        expect(revealed(state).namedMove, `${bobMove} @ ${r}`).not.toBe('scissors');
      }
    }
  });

  it("never sends the opponent's actual move, to either seat, before the round resolves", async () => {
    const { code, alice, bob } = await intoSubPhase('rock', 'lizard');

    const hers = await service.getState(code, alice);
    // She sees her own pick — she is being asked to keep or change it — and his
    // is nowhere: not in the moves, not in the firings, and not in the reveal,
    // which names something he did not play precisely so it can be sent.
    expect(hers.currentRoundMoves).toEqual({ [alice]: 'rock' });
    expect(hers.abilityFirings).toEqual([]);
    expect(hers.results).toEqual([]);
    expect(revealed(hers).namedMove).not.toBe('lizard');

    const his = await service.getState(code, bob);
    expect(his.currentRoundMoves).toEqual({ [bob]: 'lizard' });
    expect(his.abilityFirings).toEqual([]);
    expect(his.results).toEqual([]);

    // And a viewer the server cannot place gets neither seat's move.
    const spectator = await service.getState(code);
    expect(spectator.currentRoundMoves).toEqual({});
    expect(spectator.entitlement).toBeNull();
  });

  it('lets the holder re-pick, and resolves on the new move', async () => {
    // Bob played rock, so Alice's rock was heading for a draw. Told he did not
    // play paper, she switches to robot — which beats rock — and takes the round.
    const { code, alice, bob } = await intoSubPhase('rock', 'rock');
    const state = await service.submitMove(code, alice, 'robot');

    expect(state.results).toHaveLength(1);
    expect(state.results[0].moves).toEqual({ [alice]: 'robot', [bob]: 'rock' });
    expect(state.results[0].outcome).toBe('1');
    expect(state.match.currentRound).toBe(2);
    expect(state.match.phase).toBe('pick');
  });

  it('lets the holder keep their original pick by re-sending it', async () => {
    // Re-sending the move you already have is how "keep" is said, so a holder who
    // has decided need not sit out the rest of the clock.
    const { code, alice, bob } = await intoSubPhase('rock', 'rock');
    const state = await service.submitMove(code, alice, 'rock');

    expect(state.results[0].moves).toEqual({ [alice]: 'rock', [bob]: 'rock' });
    expect(state.results[0].outcome).toBe('draw');
  });

  it('spends the charge even when the holder keeps their original pick', async () => {
    const { code, alice } = await intoSubPhase('rock', 'rock');
    const state = await service.submitMove(code, alice, 'rock');
    // Opening 0, recharge 3: one round took a mark off nothing, then firing
    // charged three. Paid in full for a re-pick she declined to make.
    expect(state.abilities.oracle).toEqual({ marks: 3, available: false });
  });

  it('holds a re-pick to the moves currently live for the holder', async () => {
    // Oracle binds paper, so Alice's own paper opens on 2 marks. The reveal does
    // not buy her a move she could not otherwise play.
    const { code, alice } = await intoSubPhase('rock', 'rock');
    await expect(service.submitMove(code, alice, 'paper')).rejects.toThrow(/on cooldown/);
  });

  it('leaves a seat with no entitlement locked in for the duration', async () => {
    const { code, bob } = await intoSubPhase('rock', 'rock');
    await expect(service.submitMove(code, bob, 'paper')).rejects.toThrow(
      /locked while the round resolves/,
    );
  });

  it('refuses a second firing once the sub-phase is running', async () => {
    const { code, alice } = await intoSubPhase('rock', 'rock');
    await expect(
      service.fireAbility(code, alice, { helperId: 'oracle' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('resolves on the original pick when the sub-phase expires, charge still spent', async () => {
    const { code, alice, bob } = await intoSubPhase('rock', 'rock');
    now += 12_000;

    const state = await service.getState(code, alice);
    expect(state.results).toHaveLength(1);
    expect(state.results[0].moves).toEqual({ [alice]: 'rock', [bob]: 'rock' });
    expect(state.abilities.oracle).toEqual({ marks: 3, available: false });
    // Both picked on time, so nobody was idle and nobody is auto-picked.
    expect(state.results[0].autoPicked).toEqual([]);
    expect(state.seats.every((s) => s.player!.expiryStrikes === 0)).toBe(true);
  });

  it('resyncs a reconnecting holder to the whole sub-phase', async () => {
    const { code, alice } = await intoSubPhase('rock', 'rock');

    // A brand-new service over the same rows: nothing survives in process memory,
    // so everything the holder needs to decide has to be on disk.
    const restarted = new GameService(repo, { now: () => now, rng: () => 0 });
    const state = await restarted.getState(code, alice);

    // The entitlement, its payload, her own current move and her charge state:
    // everything she needs to decide, off disk rather than out of process memory.
    expect(state.match.phase).toBe('react');
    expect(state.entitlement).toEqual({
      round: 1,
      reveals: [{ helperId: 'oracle', namedMove: 'paper' }],
      incoming: [],
      acted: false,
    });
    expect(state.currentRoundMoves).toEqual({ [alice]: 'rock' });
    expect(state.abilities.oracle).toEqual({ marks: 0, available: false });
  });

  it('names the move once and stands by it, however often the holder reads', async () => {
    // The reveal is written down rather than re-drawn. A holder who could provoke
    // a second draw would collect every move the server is willing to name and
    // identify the opponent's as the one it never names.
    const { code, alice } = await intoSubPhase('rock', 'rock');
    const first = revealed(await service.getState(code, alice)).namedMove;

    let wandering = new GameService(repo, { now: () => now, rng: () => 0.99 });
    expect(revealed(await wandering.getState(code, alice)).namedMove).toBe(first);
    wandering = new GameService(repo, { now: () => now, rng: () => 0.5 });
    expect(revealed(await wandering.getState(code, alice)).namedMove).toBe(first);
  });

  it('tells the opponent Oracle was used and which move it named, once resolved', async () => {
    const { code, alice, bob } = await intoSubPhase('rock', 'rock');
    await service.submitMove(code, alice, 'robot');

    const his = await service.getState(code, bob);
    expect(his.abilityFirings).toEqual([
      { round: 1, seatKey: '1', helperId: 'oracle', target: 'paper', source: null },
    ]);
    // The reveal itself is over, so it stops being projected to anyone.
    expect(his.entitlement).toBeNull();
    expect((await service.getState(code, alice)).entitlement).toBeNull();
  });

  it('opens the sub-phase exactly once when Oracle is fired alongside another ability', async () => {
    // JQ-238 lets a seat spend two slots in a round. A round still has at most one
    // sub-phase, and the sibling firing resolves with the round like any other.
    const created = await service.createStandaloneMatch({
      gameMode: 'duel-helpers',
      hostName: 'Alice',
      bestOf: 5,
      seats: [
        { seatKey: '1', options: [{ groupKey: 'helpers', optionIds: ['oracle', 'freeze'] }] },
        { seatKey: '2', options: [{ groupKey: 'helpers', optionIds: ['rust', 'poker-face'] }] },
      ],
    });
    const code = created.state.match.code;
    const alice = created.you.playerId;
    const bob = (await service.claimSeat(code, { seatKey: '2', name: 'Bob' })).you.playerId;

    await service.fireAbility(code, alice, { helperId: 'oracle' });
    await service.fireAbility(code, alice, { helperId: 'freeze' });
    await service.submitMove(code, alice, 'rock');
    await service.submitMove(code, bob, 'rock');

    // One sub-phase, and the reveal belongs to Oracle alone — Freeze names nothing
    // and must not have been handed the draw.
    const held = await service.getState(code, alice);
    expect(held.match.phase).toBe('react');
    expect(held.entitlement).toEqual({
      round: 1,
      reveals: [{ helperId: 'oracle', namedMove: 'paper' }],
      incoming: [],
      acted: false,
    });

    // Alice acting does not end the round any more: Freeze is public since JQ-209,
    // so Bob holds the other half of the same sub-phase — one window, two seats
    // entitled for different reasons. Oracle told Alice something; Freeze handed Bob
    // something to answer.
    const midway = await service.submitMove(code, alice, 'rock');
    expect(midway.match.phase).toBe('react');
    expect((await service.getState(code, bob)).entitlement).toEqual({
      round: 1,
      reveals: [],
      incoming: [{ helperId: 'freeze', target: null }],
      acted: false,
    });

    // Bob's scissors is Rust-bound and on 2, so he stands on the pick he made.
    const state = await service.submitMove(code, bob, 'rock');
    expect(state.match.phase).toBe('pick');
    expect(state.abilityFirings).toEqual([
      { round: 1, seatKey: '1', helperId: 'oracle', target: 'paper', source: null },
      { round: 1, seatKey: '1', helperId: 'freeze', target: null, source: null },
    ]);
    // Freeze resolved with the round: Bob's scissors did not come off.
    expect(state.seats[1].delays).toEqual({ rock: 2, paper: 0, scissors: 2, lizard: 0, robot: 0 });
  });

  it('leaves every other loadout resolving through the unchanged path', async () => {
    const { code, alice, bob } = await oracleMatch(['rust', 'poker-face']);
    // Bob fires Rust — not Oracle, so it reveals him nothing, and secret, so it
    // hands Alice nothing to answer. His round resolves the moment both are in, with
    // no sub-phase between. Freeze stood here once and Quarantine after it; JQ-209
    // made both public, and a public firing is itself a route into the window. Rust
    // and Thief are what is left, which is worth knowing if this test moves again.
    await service.fireAbility(code, bob, { helperId: 'rust', target: 'paper' });
    await service.submitMove(code, alice, 'rock');
    // Rust binds Bob's scissors, so he plays a move he actually has.
    const state = await service.submitMove(code, bob, 'lizard');

    expect(state.results).toHaveLength(1);
    expect(state.match.currentRound).toBe(2);
    expect(state.match.phase).toBe('pick');
  });

  describe('two Oracles facing each other — a legal pairing, since a loadout is per seat', () => {
    async function mirrorMatch() {
      const created = await service.createStandaloneMatch({
        gameMode: 'duel-helpers',
        hostName: 'Alice',
        bestOf: 5,
        seats: [
          { seatKey: '1', options: [{ groupKey: 'helpers', optionIds: ['oracle', 'poker-face'] }] },
          { seatKey: '2', options: [{ groupKey: 'helpers', optionIds: ['oracle', 'watchful'] }] },
        ],
      });
      const code = created.state.match.code;
      const joined = await service.claimSeat(code, { seatKey: '2', name: 'Bob' });
      const alice = created.you.playerId;
      const bob = joined.you.playerId;
      await service.fireAbility(code, alice, { helperId: 'oracle' });
      await service.fireAbility(code, bob, { helperId: 'oracle' });
      await service.submitMove(code, alice, 'rock');
      await service.submitMove(code, bob, 'rock');
      return { code, alice, bob };
    }

    it('names a move for both holders, not just whichever seat is found first', async () => {
      const { code, alice, bob } = await mirrorMatch();

      // Both paid, so both are told something. A holder handed a spent charge and
      // a null reveal would have been robbed by an implementation detail.
      const hers = await service.getState(code, alice);
      const his = await service.getState(code, bob);
      expect(revealed(hers).namedMove).not.toBeNull();
      expect(revealed(his).namedMove).not.toBeNull();
      // And each is told a move the *other* did not play.
      expect(revealed(hers).namedMove).not.toBe('rock');
      expect(revealed(his).namedMove).not.toBe('rock');
    });

    it('resolves once both have acted, and never on the first of the two', async () => {
      const { code, alice, bob } = await mirrorMatch();

      // Alice re-picks. Bob is still deciding, and must not have his sub-phase cut
      // short — nor be told, by the round simply ending, that she already moved.
      let state = await service.submitMove(code, alice, 'robot');
      expect(state.match.phase).toBe('react');
      expect(state.results).toEqual([]);
      expect((await service.getState(code, bob)).entitlement).not.toBeNull();

      // Bob re-picks too. Everyone entitled has now acted, so the round resolves
      // on the spot rather than costing them both the rest of the allowance —
      // which is what JQ-150 had to do, having nowhere to write "this seat acted".
      state = await service.submitMove(code, bob, 'lizard');
      expect(state.results).toHaveLength(1);
      expect(state.results[0].moves).toEqual({ [alice]: 'robot', [bob]: 'lizard' });
      expect(state.match.phase).toBe('pick');
      expect(state.match.currentRound).toBe(2);
    });

    it('records that a seat acted even when it kept the move it already had', async () => {
      // A kept move is byte-identical to an unchanged one, so acting has to be
      // written down or the round could never tell a keep from a no-show.
      const { code, alice, bob } = await mirrorMatch();

      await service.submitMove(code, alice, 'rock');
      const hers = await service.getState(code, alice);
      expect(hers.entitlement!.acted).toBe(true);
      expect(hers.results).toEqual([]);
      // And Bob's own claim is untouched by her having used hers.
      expect((await service.getState(code, bob)).entitlement!.acted).toBe(false);

      const state = await service.submitMove(code, bob, 'rock');
      expect(state.results).toHaveLength(1);
      expect(state.results[0].moves).toEqual({ [alice]: 'rock', [bob]: 'rock' });
    });

    it('still waits out the clock when one of the two never answers', async () => {
      const { code, alice, bob } = await mirrorMatch();
      await service.submitMove(code, alice, 'robot');

      // Bob says nothing. The window belongs to him until it expires, and then the
      // round resolves on the pick he already had.
      now += 12_000;
      const state = await service.getState(code, alice);
      expect(state.results).toHaveLength(1);
      expect(state.results[0].moves).toEqual({ [alice]: 'robot', [bob]: 'rock' });
      // Nobody was idle — both picked on time — so no strikes and no auto-picks.
      expect(state.results[0].autoPicked).toEqual([]);
      expect(state.seats.every((s) => s.player!.expiryStrikes === 0)).toBe(true);
    });
  });

  it('resolves a timed-out round rather than granting a sub-phase on top', async () => {
    // Alice fired and locked in; Bob went quiet. The round has already overrun,
    // so it resolves on his auto-pick — a further allowance would reward the
    // overrun. Her charge stays spent: it was spent when she fired.
    const { code, alice, bob } = await oracleMatch();
    await service.fireAbility(code, alice, { helperId: 'oracle' });
    await service.submitMove(code, alice, 'rock');
    now += 45_000;

    const state = await service.getState(code, alice);
    expect(state.match.phase).toBe('pick');
    expect(state.match.currentRound).toBe(2);
    expect(state.results).toHaveLength(1);
    expect(state.results[0].autoPicked).toEqual([bob]);
    expect(state.abilities.oracle).toEqual({ marks: 3, available: false });
  });
});
