import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryGameRepository } from './memoryRepository.js';
import { PresenceTracker } from './presence.js';
import { GameService } from './service.js';

/**
 * End-to-end idle policy, driven by an injected clock rather than real time.
 * @see roundPolicy.ts
 */
describe('GameService — round deadlines and the idle policy', () => {
  let now = 1_000_000;
  let presence: PresenceTracker;
  let service: GameService;

  beforeEach(() => {
    now = 1_000_000;
    presence = new PresenceTracker(() => now);
    service = new GameService(new MemoryGameRepository(), {
      presence,
      now: () => now,
      rng: () => 0, // always the first live move, so assertions are exact
    });
  });

  async function setupMatch(bestOf = 5) {
    const created = await service.createStandaloneMatch({ hostName: 'Alice', bestOf });
    const code = created.state.match.code;
    const joined = await service.claimSeat(code, { seatKey: '2', name: 'Bob' });
    return { code, hostId: created.you.playerId, challengerId: joined.you.playerId };
  }

  describe('the deadline itself', () => {
    it('is not running before both seats are filled', async () => {
      const created = await service.createStandaloneMatch({ hostName: 'Alice' });
      expect(created.state.match.phaseDeadline).toBeNull();
      expect(created.state.match.phase).toBeNull();
    });

    it('starts when the match does, giving round 1 the longer allowance', async () => {
      const { code } = await setupMatch();
      const state = await service.getState(code);
      expect(state.match.phase).toBe('pick');
      expect(Date.parse(state.match.phaseDeadline!)).toBe(now + 45_000);
    });

    it('gives later rounds the shorter allowance, measured from the resolve', async () => {
      const { code, hostId, challengerId } = await setupMatch();
      now += 5_000;
      await service.submitMove(code, hostId, 'rock');
      await service.submitMove(code, challengerId, 'scissors');
      const state = await service.getState(code);
      expect(state.match.currentRound).toBe(2);
      expect(Date.parse(state.match.phaseDeadline!)).toBe(now + 20_000);
    });

    it('ships the server clock so the client need not trust its own', async () => {
      const { code } = await setupMatch();
      const state = await service.getState(code);
      expect(Date.parse(state.serverNow)).toBe(now);
    });

    it('stops running once the match is over', async () => {
      const { code, hostId, challengerId } = await setupMatch(1);
      await service.submitMove(code, hostId, 'rock');
      await service.submitMove(code, challengerId, 'scissors');
      const state = await service.getState(code);
      expect(state.match.status).toBe('finished');
      expect(state.match.phaseDeadline).toBeNull();
    });
  });

  describe('first expiry — auto-pick', () => {
    it('picks a live move for the silent player and resolves the round', async () => {
      const { code, hostId } = await setupMatch();
      await service.submitMove(code, hostId, 'rock');
      now += 45_001;

      const state = await service.getState(code);
      expect(state.results).toHaveLength(1);
      // rng 0 selects the first live move; the opening blocks lizard and robot.
      expect(state.results[0].moves[hostId]).toBe('rock');
      expect(state.match.status).toBe('playing');
    });

    it('announces who did not choose their own move', async () => {
      const { code, hostId, challengerId } = await setupMatch();
      await service.submitMove(code, hostId, 'rock');
      now += 45_001;

      const state = await service.getState(code);
      expect(state.results[0].autoPicked).toEqual([challengerId]);
    });

    it('leaves the player who did pick out of the announcement', async () => {
      const { code, hostId } = await setupMatch();
      await service.submitMove(code, hostId, 'rock');
      now += 45_001;
      const state = await service.getState(code);
      expect(state.results[0].autoPicked).not.toContain(hostId);
    });

    it('spends a cooldown, so walking away still costs something', async () => {
      const { code, hostId, challengerId } = await setupMatch();
      await service.submitMove(code, hostId, 'rock');
      now += 45_001;
      const state = await service.getState(code);

      const bob = state.seats.find((s) => s.player?.id === challengerId)!;
      // Whatever was chosen for them is now on cooldown like any played move.
      expect(bob.delays[state.results[0].moves[challengerId]]).toBeGreaterThan(0);
    });

    it('does nothing at all before the deadline', async () => {
      const { code, hostId } = await setupMatch();
      await service.submitMove(code, hostId, 'rock');
      now += 44_999;
      const state = await service.getState(code);
      expect(state.results).toHaveLength(0);
    });

    it('is idempotent across concurrent readers', async () => {
      const { code, hostId } = await setupMatch();
      await service.submitMove(code, hostId, 'rock');
      now += 45_001;
      await Promise.all([
        service.getState(code),
        service.getState(code),
        service.getState(code),
      ]);
      const state = await service.getState(code);
      expect(state.results).toHaveLength(1);
    });
  });

  describe('second consecutive expiry — forfeit', () => {
    it('ends the match in favour of the player who kept showing up', async () => {
      const { code, hostId } = await setupMatch();
      await service.submitMove(code, hostId, 'rock');
      now += 45_001; // round 1 expires -> auto-pick, strike 1
      await service.getState(code);

      await service.submitMove(code, hostId, 'paper');
      now += 20_001; // round 2 expires -> strike 2
      const state = await service.getState(code);

      expect(state.match.status).toBe('finished');
      expect(state.match.endReason).toBe('forfeit-strikes');
      expect(state.matchWinnerSeatKey).toBe('1');
    });

    it('forgives a miss once the player comes back', async () => {
      const { code, hostId, challengerId } = await setupMatch();
      await service.submitMove(code, hostId, 'rock');
      now += 45_001; // strike 1 for Bob
      await service.getState(code);

      // Bob plays round 2 on time — the run of silence is broken.
      await service.submitMove(code, hostId, 'paper');
      await service.submitMove(code, challengerId, 'lizard');

      const midway = await service.getState(code);
      const bob = midway.seats.find((s) => s.player?.id === challengerId)!;
      expect(bob.player!.expiryStrikes).toBe(0);

      // So a later miss is a first miss again: auto-pick, not forfeit.
      await service.submitMove(code, hostId, 'scissors');
      now += 20_001;
      const state = await service.getState(code);
      expect(state.match.status).toBe('playing');
    });
  });

  describe('disconnect grace — absent is not the same as slow', () => {
    it('leaves a connected but slow player to the ordinary deadline', async () => {
      const { code, hostId, challengerId } = await setupMatch();
      await service.markConnected(code, challengerId);
      await service.submitMove(code, hostId, 'rock');
      now += 44_000; // long gone past the grace period, but still connected
      const state = await service.getState(code);
      expect(state.match.status).toBe('playing');
      expect(state.results).toHaveLength(0);
    });

    it('forfeits a player whose socket has been gone past the grace period', async () => {
      const { code, hostId, challengerId } = await setupMatch();
      await service.markConnected(code, challengerId);
      await service.submitMove(code, hostId, 'rock');
      await service.markDisconnected(code, challengerId);
      now += 45_001;

      const state = await service.getState(code);
      expect(state.match.status).toBe('finished');
      expect(state.match.endReason).toBe('forfeit-disconnect');
      expect(state.matchWinnerSeatKey).toBe('1');
    });

    it('does not forfeit a player who dropped after locking in', async () => {
      const { code, challengerId } = await setupMatch();
      await service.markConnected(code, challengerId);
      await service.submitMove(code, challengerId, 'rock');
      await service.markDisconnected(code, challengerId);
      now += 45_001;

      // Bob's move is in; Alice is the one still owing a pick.
      const state = await service.getState(code);
      expect(state.match.endReason).not.toBe('forfeit-disconnect');
    });

    it('gives a player who reconnects in time a clean slate', async () => {
      const { code, hostId, challengerId } = await setupMatch();
      await service.markConnected(code, challengerId);
      await service.submitMove(code, hostId, 'rock');
      await service.markDisconnected(code, challengerId);
      now += 30_000;
      await service.markConnected(code, challengerId);
      now += 30_000; // 60s since the drop, but they came back inside the grace

      const state = await service.getState(code);
      expect(state.match.endReason).not.toBe('forfeit-disconnect');
    });

    it('abandons the match when both players are gone', async () => {
      const { code, hostId, challengerId } = await setupMatch();
      await service.markConnected(code, hostId);
      await service.markConnected(code, challengerId);
      await service.markDisconnected(code, hostId);
      await service.markDisconnected(code, challengerId);
      now += 45_001;

      const state = await service.getState(code);
      expect(state.match.status).toBe('finished');
      expect(state.match.endReason).toBe('abandoned');
      expect(state.matchWinnerSeatKey).toBeNull();
    });
  });

  describe('reconnect', () => {
    it('resyncs the running deadline rather than restarting the countdown', async () => {
      const { code } = await setupMatch();
      const atStart = await service.getState(code);
      now += 10_000;
      const afterReturn = await service.getState(code);

      // Same absolute deadline; the returning player has 35s left, not 45s.
      expect(afterReturn.match.phaseDeadline).toBe(atStart.match.phaseDeadline);
      expect(Date.parse(afterReturn.match.phaseDeadline!) - now).toBe(35_000);
    });

    it('shows a returning player the expiry they missed', async () => {
      const { code, hostId, challengerId } = await setupMatch();
      await service.submitMove(code, hostId, 'rock');
      now += 45_001;

      // Bob comes back after the round already resolved without him.
      const state = await service.getState(code);
      expect(state.results[0].autoPicked).toEqual([challengerId]);
      expect(state.match.currentRound).toBe(2);
    });
  });

  describe('a move racing the deadline', () => {
    it('rejects a move that arrives after the match was forfeited', async () => {
      const { code, hostId, challengerId } = await setupMatch();
      await service.submitMove(code, hostId, 'rock');
      now += 45_001;
      await service.getState(code); // strike 1
      await service.submitMove(code, hostId, 'paper');
      now += 20_001;
      await service.getState(code); // strike 2 -> forfeit

      await expect(service.submitMove(code, challengerId, 'rock')).rejects.toThrow(
        /already finished/,
      );
    });

    it('settles the expiry first when a late move and an expiry coincide', async () => {
      const { code, hostId, challengerId } = await setupMatch();
      await service.submitMove(code, hostId, 'rock');
      now += 45_001;

      // Bob's move lands after the deadline: the policy has already picked for
      // him, so this counts against round 2, not round 1.
      const state = await service.submitMove(code, challengerId, 'lizard');
      expect(state.results).toHaveLength(1);
      expect(state.results[0].autoPicked).toEqual([challengerId]);
      expect(state.match.currentRound).toBe(2);
    });
  });
});
