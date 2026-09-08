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
    const { code, matchId, seatId } = await playingMatch();
    await repo.recordAbilityFiring({
      matchId,
      seatId,
      round: 1,
      helperId: 'quarantine',
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

  it("refuses Oracle, whose effect JQ-150 owns — a charge spent on nothing is worse than a no", async () => {
    const { code, alice } = await helpersMatch(['oracle', 'poker-face'], ['rust', 'poker-face']);
    await expect(service.fireAbility(code, alice, { helperId: 'oracle' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    const state = await service.getState(code, alice);
    expect(state.abilities.oracle.available).toBe(true);
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
    // Bob's lizard: 2 entering, decremented to 1, then Rust's 2 on top.
    expect(state.seats[1].delays).toEqual({ rock: 0, paper: 2, scissors: 0, lizard: 3, robot: 0 });
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
    const state = await playRound(code, alice, 'paper', bob, 'rock');

    // Bob's marks did not come off this round: scissors held at 1 and paper at 2,
    // where an unfrozen round would have left 0 and 1.
    expect(state.seats[1].delays).toEqual({ rock: 2, paper: 2, scissors: 1, lizard: 0, robot: 0 });
    expect(state.seats[0].delays).toEqual({ rock: 1, paper: 2, scissors: 0, lizard: 0, robot: 0 });
    // Read as Alice: `playRound` returns Bob's view, because Bob moved last — which
    // is the projection doing its job. The recharge landed with the round rather
    // than at firing time.
    expect(state.abilities).toEqual({ rust: { marks: 0, available: true } });
    const asAlice = await service.getState(code, alice);
    expect(asAlice.abilities).toEqual({ freeze: { marks: 3, available: false } });
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
    const { code, alice, bob } = await helpersMatch(
      ['quarantine', 'poker-face'],
      ['rust', 'poker-face'],
    );
    await service.fireAbility(code, alice, { helperId: 'quarantine', target: 'rock' });

    const midRound = await service.getState(code, bob);
    expect(midRound.abilityFirings).toEqual([]);
    // Bob is told about his own charge and nothing about Alice's.
    expect(Object.keys(midRound.abilities)).toEqual(['rust']);

    // Both hold a scissors-binding Major, so both open with scissors on cooldown.
    const resolved = await playRound(code, alice, 'rock', bob, 'rock');
    expect(resolved.abilityFirings).toEqual([
      { round: 1, seatKey: '1', helperId: 'quarantine', target: 'rock', source: null },
    ]);
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
