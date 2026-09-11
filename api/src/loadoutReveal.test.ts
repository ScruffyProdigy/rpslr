/**
 * JQ-149: the loadout reveal as a phase.
 *
 * The segment before round 1 in which both loadouts are shown face-up. It was
 * very nearly the first few seconds of round 1's own allowance, which is cheaper
 * and would have been wrong in two ways this suite pins: the round-1 clock would
 * have been running down while a player read four helper cards, and expiry would
 * have reached a player who had not been asked for anything yet.
 *
 * Reading is also slower than it looks — watched players spent a good 30 seconds
 * on the how-to-play panels — so the deadline is a generous cap rather than a
 * duration, and the usual way out is both players saying they have read it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryGameRepository } from './memoryRepository.js';
import { ConflictError } from './repository.js';
import { GameService } from './service.js';

describe('the loadout reveal (JQ-149)', () => {
  let repo: MemoryGameRepository;
  let service: GameService;
  let now: number;

  const T0 = Date.parse('2026-01-01T00:00:00.000Z');

  beforeEach(() => {
    repo = new MemoryGameRepository();
    now = T0;
    service = new GameService(repo, { now: () => now, rng: () => 0 });
  });

  async function helpersMatch(
    alice = ['ferrus', 'echo-chamber'],
    bob = ['chimera', 'poker-face'],
  ) {
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

  async function duelMatch() {
    const created = await service.createStandaloneMatch({ hostName: 'Alice', bestOf: 5 });
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

  describe('entering it', () => {
    it('opens a helpers match on the reveal rather than on the first pick', async () => {
      const { code } = await helpersMatch();
      const state = await service.getState(code);
      expect(state.match.phase).toBe('loadouts');
      expect(state.match.currentRound).toBe(1);
    });

    it('puts it on its own clock, separate from round 1', async () => {
      const { code } = await helpersMatch();
      const state = await service.getState(code);
      // 45s, and round 1 has not started spending its 60s.
      expect(Date.parse(state.match.phaseDeadline!) - Date.parse(state.match.phaseStartedAt!)).toBe(
        45_000,
      );
    });

    it('opens a duel straight on the first pick, exactly as it always did', async () => {
      // The test is the loadout, not the mode key: `duel` is the null loadout
      // rather than a special case, so a future mode bringing helpers inherits
      // the reveal without being listed anywhere.
      const { code } = await duelMatch();
      expect((await service.getState(code)).match.phase).toBe('pick');
    });

    it('does not start it before both seats have arrived', async () => {
      const created = await service.createStandaloneMatch({
        gameMode: 'duel-helpers',
        hostName: 'Alice',
        bestOf: 5,
        seats: [
          { seatKey: '1', options: [{ groupKey: 'helpers', optionIds: ['ferrus', 'copycat'] }] },
          { seatKey: '2', options: [{ groupKey: 'helpers', optionIds: ['oracle', 'watchful'] }] },
        ],
      });
      expect(created.state.match.phase).toBeNull();
    });

    it('reports the same phase to a reload, because the phase is the server state', async () => {
      // This is what makes "a reload during the reveal restores rather than
      // replays" true by construction rather than by the client remembering.
      const { code, alice } = await helpersMatch();
      expect((await service.getState(code, alice)).match.phase).toBe('loadouts');
      now += 20_000;
      expect((await service.getState(code, alice)).match.phase).toBe('loadouts');
    });
  });

  describe('while it is running', () => {
    it('refuses a move — round 1 has not begun', async () => {
      const { code, alice } = await helpersMatch();
      await expect(service.submitMove(code, alice, 'rock')).rejects.toBeInstanceOf(ConflictError);
    });

    it('refuses a firing for the same reason', async () => {
      const { code, alice } = await helpersMatch(['quarantine', 'copycat']);
      await expect(
        service.fireAbility(code, alice, { helperId: 'quarantine', target: 'rock' }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('costs nobody a strike, however long it runs', async () => {
      // The idle policy counts a run of silence. Nobody has been asked for
      // anything yet, so there has been none — this is the half of the argument
      // that "the first few seconds of round 1" could not have had.
      const { code, alice } = await helpersMatch();
      now += 45_001;
      const state = await service.getState(code, alice);
      expect(state.seats.every((s) => s.player!.expiryStrikes === 0)).toBe(true);
      expect(state.match.status).toBe('playing');
      expect(state.results).toEqual([]);
    });
  });

  describe('leaving it', () => {
    it('starts round 1 once both players say they have read it', async () => {
      const { code, alice, bob } = await helpersMatch();
      await service.acknowledgeLoadouts(code, alice);
      await service.acknowledgeLoadouts(code, bob);
      const state = await service.getState(code);
      expect(state.match.phase).toBe('pick');
      expect(state.match.currentRound).toBe(1);
    });

    it('hands round 1 its whole allowance, not what the reveal left over', async () => {
      const { code, alice, bob } = await helpersMatch();
      now += 30_000;
      await service.acknowledgeLoadouts(code, alice);
      await service.acknowledgeLoadouts(code, bob);
      const state = await service.getState(code);
      expect(Date.parse(state.match.phaseDeadline!) - Date.parse(state.match.phaseStartedAt!)).toBe(
        60_000,
      );
    });

    it('waits for both — one player is not done reading because the other is', async () => {
      const { code, alice } = await helpersMatch();
      await service.acknowledgeLoadouts(code, alice);
      expect((await service.getState(code)).match.phase).toBe('loadouts');
    });

    it('counts one seat once, however many times they tap', async () => {
      const { code, alice } = await helpersMatch();
      await service.acknowledgeLoadouts(code, alice);
      await service.acknowledgeLoadouts(code, alice);
      await service.acknowledgeLoadouts(code, alice);
      expect((await service.getState(code)).match.phase).toBe('loadouts');
    });

    it('ends on the deadline when somebody has walked away instead', async () => {
      const { code, alice } = await helpersMatch();
      await service.acknowledgeLoadouts(code, alice);
      now += 45_001;
      expect((await service.getState(code)).match.phase).toBe('pick');
    });

    it('takes the move that follows, which is the whole point of getting out', async () => {
      const { code, alice, bob } = await helpersMatch();
      await service.acknowledgeLoadouts(code, alice);
      await service.acknowledgeLoadouts(code, bob);
      await service.submitMove(code, alice, 'rock');
      const state = await service.submitMove(code, bob, 'paper');
      expect(state.results).toHaveLength(1);
    });

    it('answers a late ack with state rather than an error', async () => {
      // A tap that loses to the deadline is a tap on the same intention, and the
      // outcome it wanted has already happened. A 409 would turn that into
      // something the player sees go wrong.
      const { code, alice } = await helpersMatch();
      now += 45_001;
      const state = await service.acknowledgeLoadouts(code, alice);
      expect(state.match.phase).toBe('pick');
    });

    it('does not restart round 1 for a second ack that arrives after it began', async () => {
      // Both acks land, round 1 starts on its 60s, and a straggler tap must not
      // hand anybody a fresh allowance.
      const { code, alice, bob } = await helpersMatch();
      await service.acknowledgeLoadouts(code, alice);
      await service.acknowledgeLoadouts(code, bob);
      const opened = (await service.getState(code)).match.phaseDeadline;
      now += 5_000;
      await service.acknowledgeLoadouts(code, alice);
      expect((await service.getState(code)).match.phaseDeadline).toBe(opened);
    });

    it('is a no-op on a duel, which never entered it', async () => {
      const { code, alice } = await duelMatch();
      const state = await service.acknowledgeLoadouts(code, alice);
      expect(state.match.phase).toBe('pick');
    });
  });
});
