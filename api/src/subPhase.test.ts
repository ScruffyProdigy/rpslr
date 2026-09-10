/**
 * JQ-239: the round sub-phase as a class, not as Oracle's private machinery.
 *
 * The class is *information that reaches a player after their commitment and
 * before the round resolves*. Oracle gets there by revealing to its own holder; a
 * public firing gets there by revealing to the player it acts against. Oracle's own
 * behaviour through the general path is pinned by JQ-150's suite in
 * `service.test.ts`; this file covers the other way in, and the properties that
 * only appear once there is more than one member.
 *
 * ## Why the roster is faked here
 *
 * Every card is `secret` today — JQ-235 changed no card's behaviour — so the public
 * branch has no card to exercise it. Making Rust public for this file is the
 * difference between "this works" and "this compiles": the whole point of the
 * generalisation is that the next public card needs no service change, and an
 * untested branch would not deliver that.
 *
 * Freeze is genuinely public since JQ-209, so this path now has a shipping card on
 * it. The mock stays because Rust is the card with a binding and a target that make
 * the re-pick assertions below precise — Freeze names no move.
 *
 * Only `firesInPublic` is replaced. Rust's marks, its binding and its validation
 * are the real ones, so nothing here depends on a card that does not exist.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./helpers/roster.js', async () => {
  const actual = await vi.importActual<typeof import('./helpers/roster.js')>('./helpers/roster.js');
  return { ...actual, firesInPublic: (id: string) => id === 'rust' };
});

const { MemoryGameRepository } = await import('./memoryRepository.js');
const { GameService } = await import('./service.js');

describe('the sub-phase, reached by a public firing rather than by a reveal', () => {
  let repo: InstanceType<typeof MemoryGameRepository>;
  let service: InstanceType<typeof GameService>;
  let now: number;

  beforeEach(() => {
    repo = new MemoryGameRepository();
    now = Date.parse('2026-01-01T00:00:00.000Z');
    // rng() === 0 takes the first candidate, so a named move is exact.
    service = new GameService(repo, { now: () => now, rng: () => 0 });
  });

  /**
   * Alice holds Rust (binds scissors) — public, in this file. Bob holds Quarantine,
   * which also binds scissors, so he has the cooldown Rust needs to deepen and his
   * live moves are rock, paper, lizard and robot.
   */
  async function match(alice = ['rust', 'poker-face'], bob = ['quarantine', 'poker-face']) {
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

  /** Fire the public Rust and lock both in, leaving the round in the sub-phase. */
  async function intoSubPhase(aliceMove = 'rock', bobMove = 'rock') {
    const m = await match();
    await service.fireAbility(m.code, m.alice, { helperId: 'rust', target: 'scissors' });
    await service.submitMove(m.code, m.alice, aliceMove);
    await service.submitMove(m.code, m.bob, bobMove);
    return m;
  }

  it('announces a public firing as it happens, without waiting for the round', async () => {
    const { code, alice, bob } = await match();
    await service.fireAbility(code, alice, { helperId: 'rust', target: 'scissors' });

    // Bob is told, mid-round, exactly what a resolved round would have told him.
    const his = await service.getState(code, bob);
    expect(his.abilityFirings).toEqual([
      { round: 1, seatKey: '1', helperId: 'rust', target: 'scissors', source: null },
    ]);
  });

  it('opens the window for the seat it acts against, and not for the firer', async () => {
    const { code, alice, bob } = await intoSubPhase();

    const state = await service.getState(code, bob);
    expect(state.match.phase).toBe('react');
    expect(state.entitlement).toEqual({
      round: 1,
      reveals: [],
      incoming: [{ helperId: 'rust', target: 'scissors' }],
      acted: false,
    });
    // Alice spent the charge; she was not the one handed something to answer.
    expect((await service.getState(code, alice)).entitlement).toBeNull();
  });

  it('locks the firer out of re-picking, with a clear error', async () => {
    const { code, alice } = await intoSubPhase();
    await expect(service.submitMove(code, alice, 'paper')).rejects.toThrow(
      /locked while the round resolves/,
    );
  });

  it('lets the entitled seat swap for any move still live for them', async () => {
    const { code, alice, bob } = await intoSubPhase('rock', 'rock');
    const state = await service.submitMove(code, bob, 'paper');

    expect(state.results).toHaveLength(1);
    expect(state.results[0].moves).toEqual({ [alice]: 'rock', [bob]: 'paper' });
    expect(state.match.phase).toBe('pick');
  });

  it('holds a re-pick to the moves live for that seat', async () => {
    // Quarantine binds Bob's scissors, and Rust has just deepened it further. The
    // window does not buy him a move he could not otherwise play.
    const { code, bob } = await intoSubPhase();
    await expect(service.submitMove(code, bob, 'scissors')).rejects.toThrow(/on cooldown/);
  });

  it('opens the window whether or not the firing landed', async () => {
    // Rust named scissors; Bob played rock, so it hit nothing of his round. He is
    // entitled all the same — if he were not, the absence of a window would tell
    // Alice her firing missed, which is a tell she has not paid for.
    const { code, bob } = await intoSubPhase('rock', 'rock');
    const state = await service.getState(code, bob);
    expect(state.entitlement).not.toBeNull();
    // And he is told what was fired, not whether it reached him.
    expect(JSON.stringify(state.entitlement)).not.toContain('rock');
  });

  it('puts the sub-phase on its own clock, and resolves on the standing picks at expiry', async () => {
    const { code, alice, bob } = await intoSubPhase('rock', 'lizard');
    expect((await service.getState(code, bob)).match.phaseDeadline).toBe(
      new Date(now + 12_000).toISOString(),
    );

    now += 12_000;
    const state = await service.getState(code, bob);
    expect(state.results[0].moves).toEqual({ [alice]: 'rock', [bob]: 'lizard' });
    // Both picked on time, so expiry costs nobody a strike and nothing is auto-picked.
    expect(state.results[0].autoPicked).toEqual([]);
    expect(state.seats.every((s) => s.player!.expiryStrikes === 0)).toBe(true);
    // The charge stays spent: it was spent when it was fired.
    expect((await service.getState(code, alice)).abilities.rust).toEqual({
      // Rust recharges on 4 since JQ-209 repriced it.
      marks: 4,
      available: false,
    });
  });

  it('refuses a firing made during the sub-phase, so a round can never cascade', async () => {
    // Non-cascading is what makes "at most one sub-phase per round" true: without
    // it a public firing inside a window would open another and the round would
    // never close.
    const { code, bob } = await intoSubPhase();
    await expect(
      service.fireAbility(code, bob, { helperId: 'quarantine', target: 'rock' }),
    ).rejects.toThrow(/already resolving/);
  });

  it('resyncs a reconnecting seat to the whole window', async () => {
    const { code, bob } = await intoSubPhase('rock', 'lizard');

    // A brand-new service over the same rows: nothing survives in process memory,
    // so everything Bob needs to decide has to be on disk.
    const restarted = new GameService(repo, { now: () => now, rng: () => 0 });
    const state = await restarted.getState(code, bob);

    expect(state.match.phase).toBe('react');
    expect(state.entitlement).toEqual({
      round: 1,
      reveals: [],
      incoming: [{ helperId: 'rust', target: 'scissors' }],
      acted: false,
    });
    expect(state.currentRoundMoves).toEqual({ [bob]: 'lizard' });
    expect(state.abilities).toEqual({ quarantine: { marks: 0, available: true } });
  });

  it('leaves a round with no public firing and no reveal on the untouched path', async () => {
    // Bob fires Quarantine, which is secret and reveals nothing to him: the round
    // resolves the moment both are in, with no window between.
    const { code, alice, bob } = await match();
    await service.fireAbility(code, bob, { helperId: 'quarantine', target: 'rock' });
    await service.submitMove(code, alice, 'rock');
    const state = await service.submitMove(code, bob, 'paper');

    expect(state.results).toHaveLength(1);
    expect(state.match.phase).toBe('pick');
    expect(state.match.currentRound).toBe(2);
  });

  /**
   * The hazard the window exists to contain.
   *
   * An information card plus a blocking card multiply into certainty: Oracle names
   * a live move they did not play, a public block denies another, and the firer
   * knows the rest by elimination — a 100% win round, in a game that caps Oracle
   * at a guaranteed win 30% of the time.
   *
   * Simultaneity is what defuses it. The opponent re-picks at the same moment, so
   * the read goes stale exactly when it would otherwise be decisive.
   */
  describe('an information card and a public firing in the same round', () => {
    /** Alice holds Oracle (binds paper) and the public Rust (binds scissors). */
    async function loaded() {
      const m = await match(['oracle', 'rust'], ['quarantine', 'poker-face']);
      await service.fireAbility(m.code, m.alice, { helperId: 'oracle' });
      await service.fireAbility(m.code, m.alice, { helperId: 'rust', target: 'scissors' });
      await service.submitMove(m.code, m.alice, 'rock');
      await service.submitMove(m.code, m.bob, 'rock');
      return m;
    }

    it('entitles both seats — the reader by her reveal, the target by the firing', async () => {
      const { code, alice, bob } = await loaded();

      const hers = await service.getState(code, alice);
      expect(hers.entitlement!.reveals).toEqual([{ helperId: 'oracle', namedMove: 'paper' }]);
      expect(hers.entitlement!.incoming).toEqual([]);

      const his = await service.getState(code, bob);
      expect(his.entitlement!.reveals).toEqual([]);
      expect(his.entitlement!.incoming).toEqual([{ helperId: 'rust', target: 'scissors' }]);
    });

    it("never shows one seat the other's re-pick before the round resolves", async () => {
      const { code, alice, bob } = await loaded();
      await service.submitMove(code, alice, 'robot');

      // Alice has moved off rock. Bob is deciding at the same moment and must not
      // be able to read that anywhere in his payload — the staleness of her read is
      // the balance mechanism, and it only works if his is stale too.
      const his = await service.getState(code, bob);
      expect(his.currentRoundMoves).toEqual({ [bob]: 'rock' });
      expect(his.results).toEqual([]);
      expect(Object.values(his.currentRoundMoves)).not.toContain('robot');
      expect(JSON.stringify(his.entitlement)).not.toContain('robot');

      // And she cannot read his either, whether or not he has answered.
      const hers = await service.getState(code, alice);
      expect(hers.currentRoundMoves).toEqual({ [alice]: 'robot' });
    });

    it('resolves only once both have acted', async () => {
      const { code, alice, bob } = await loaded();

      let state = await service.submitMove(code, alice, 'robot');
      expect(state.results).toEqual([]);
      expect(state.match.phase).toBe('react');

      state = await service.submitMove(code, bob, 'lizard');
      expect(state.results).toHaveLength(1);
      expect(state.results[0].moves).toEqual({ [alice]: 'robot', [bob]: 'lizard' });
    });

    it('holds one window for the round, not one per entitlement', async () => {
      const { code, alice, bob } = await loaded();
      const opened = (await service.getState(code, alice)).match.phaseStartedAt;

      // Both act; the round resolves rather than opening a second window on the
      // back of the firing that is still unresolved when the first one begins.
      await service.submitMove(code, alice, 'robot');
      expect((await service.getState(code, bob)).match.phaseStartedAt).toBe(opened);
      const state = await service.submitMove(code, bob, 'lizard');
      expect(state.match.phase).toBe('pick');
      expect(state.match.currentRound).toBe(2);
    });
  });
});
