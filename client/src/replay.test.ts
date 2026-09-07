import { describe, expect, it } from 'vitest';
import type { MatchState, Move, RoundResult, Seat } from './api';
import { buildReplay, replayBlockedReason } from './replay';

function seat(position: number, seatKey: string, playerId: string, name: string): Seat {
  return {
    id: `seat-${seatKey}`,
    matchId: 'm1',
    seatKey,
    teamKey: null,
    role: null,
    position,
    reservedForLobbyUser: null,
    player: {
      id: playerId,
      name,
      lobbyUserId: null,
      score: 0,
      profile: null,
      expiryStrikes: 0,
    },
    lobbyProfile: null,
    delays: {},
  };
}

function round(n: number, a: Move, b: Move, outcome: string): RoundResult {
  return { round: n, outcome, moves: { pa: a, pb: b }, autoPicked: [] };
}

function state(results: RoundResult[], overrides: Partial<MatchState['match']> = {}): MatchState {
  return {
    match: {
      id: 'm1',
      code: 'ABCD',
      externalMatchId: 'ext-1',
      lobbyId: null,
      lobbyReturnUrl: null,
      lobbyGraphqlUrl: null,
      name: 'Match',
      gameMode: 'rpslr',
      status: 'finished',
      bestOf: 5,
      currentRound: results.length,
      phase: null,
      phaseStartedAt: null,
      phaseDeadline: null,
      endReason: 'played',
      winnerSeatKey: 'a',
      createdAt: '2026-09-07T00:00:00.000Z',
      ...overrides,
    },
    seats: [seat(0, 'a', 'pa', 'Ana'), seat(1, 'b', 'pb', 'Ben')],
    results,
    submittedPlayerIds: [],
    currentRoundMoves: {},
    matchWinnerSeatKey: overrides.winnerSeatKey ?? 'a',
    serverNow: '2026-09-07T00:05:00.000Z',
  };
}

describe('replayBlockedReason', () => {
  it('refuses a match that is still being played', () => {
    expect(replayBlockedReason(state([], { status: 'playing' }))).toBe("This match isn't over yet");
    expect(replayBlockedReason(state([], { status: 'waiting' }))).toBe("This match isn't over yet");
  });

  it('allows a finished match that has rounds', () => {
    expect(replayBlockedReason(state([round(1, 'rock', 'paper', 'b')]))).toBeNull();
  });

  it('refuses a finished match with no rounds to show', () => {
    expect(replayBlockedReason(state([]))).toBe('This match has no rounds to replay');
  });
});

describe('buildReplay opening cooldowns', () => {
  it('opens with lizard on 1 and robot on 2 for both players', () => {
    const [frame] = buildReplay(state([round(1, 'rock', 'paper', 'b')])).frames;
    for (const side of [frame.a, frame.b]) {
      expect(side.delaysBefore).toEqual({
        rock: 0,
        paper: 0,
        scissors: 0,
        lizard: 1,
        robot: 2,
      });
    }
  });
});

describe('buildReplay cooldown arithmetic', () => {
  it('decrements every move then charges the pick 2', () => {
    const frames = buildReplay(
      state([
        round(1, 'rock', 'paper', 'b'),
        round(2, 'scissors', 'scissors', 'draw'),
        round(3, 'paper', 'rock', 'a'),
      ]),
    ).frames;

    // Round 2 is entered after one pick: everything −1, then the pick +2.
    expect(frames[1].a.delaysBefore).toEqual({
      rock: 2,
      paper: 0,
      scissors: 0,
      lizard: 0,
      robot: 1,
    });
    // Round 3, after rock then scissors: rock has ticked down one more.
    expect(frames[2].a.delaysBefore).toEqual({
      rock: 1,
      paper: 0,
      scissors: 2,
      lizard: 0,
      robot: 0,
    });
  });

  it('never lets a delay mark go below zero', () => {
    const frames = buildReplay(
      state([
        round(1, 'rock', 'paper', 'b'),
        round(2, 'paper', 'rock', 'a'),
        round(3, 'scissors', 'lizard', 'a'),
        round(4, 'lizard', 'robot', 'a'),
      ]),
    ).frames;
    for (const value of Object.values(frames[3].a.delaysBefore)) {
      expect(value).toBeGreaterThanOrEqual(0);
    }
    expect(frames[3].a.delaysBefore.rock).toBe(0);
  });
});

describe('buildReplay scoring', () => {
  it('carries a running score that ignores draws', () => {
    const frames = buildReplay(
      state([
        round(1, 'rock', 'scissors', 'a'),
        round(2, 'paper', 'paper', 'draw'),
        round(3, 'scissors', 'rock', 'b'),
      ]),
    ).frames;

    expect(frames.map((f) => [f.a.score, f.b.score])).toEqual([
      [1, 0],
      [1, 0],
      [1, 1],
    ]);
  });

  it('reports the final score of a 3-2 five-round match', () => {
    const replay = buildReplay(
      state([
        round(1, 'rock', 'scissors', 'a'),
        round(2, 'paper', 'scissors', 'b'),
        round(3, 'scissors', 'paper', 'a'),
        round(4, 'lizard', 'rock', 'b'),
        round(5, 'robot', 'scissors', 'a'),
      ]),
    );

    expect(replay.frames).toHaveLength(5);
    expect(replay.finalScore).toEqual({ a: 3, b: 2 });
    expect(replay.winnerSeatKey).toBe('a');
    expect(replay.bestOf).toBe(5);
  });
});

describe('buildReplay frame detail', () => {
  it('names both players from their seats, blue seat first by position', () => {
    const replay = buildReplay(state([round(1, 'rock', 'paper', 'b')]));
    expect(replay.a.identity.name).toBe('Ana');
    expect(replay.b.identity.name).toBe('Ben');
    expect(replay.a.seatKey).toBe('a');
  });

  it('exposes each move played and who the round went to', () => {
    const [frame] = buildReplay(state([round(1, 'rock', 'paper', 'b')])).frames;
    expect(frame.round).toBe(1);
    expect(frame.a.move).toBe('rock');
    expect(frame.b.move).toBe('paper');
    expect(frame.outcome).toBe('b');
  });

  it('lists the moves that could not lose, given the other player cooldowns', () => {
    // Round 1 both sides hold lizard on 1 and robot on 2, so neither can
    // attack with them. Rock is beaten by paper and lizard — paper is live, so
    // rock is not safe. Scissors is beaten by rock and robot; rock is live.
    // Robot is beaten by paper and lizard; paper is live. Nothing is safe.
    const [frame] = buildReplay(state([round(1, 'rock', 'paper', 'b')])).frames;
    expect(frame.a.safeMoves).toEqual([]);
    expect(frame.a.delaysBefore.robot).toBe(2);
  });

  it('marks a move the server picked when a player ran out of time', () => {
    const timedOut: RoundResult = {
      round: 1,
      outcome: 'a',
      moves: { pa: 'rock', pb: 'scissors' },
      autoPicked: ['pb'],
    };
    const [frame] = buildReplay(state([timedOut])).frames;
    expect(frame.a.autoPicked).toBe(false);
    expect(frame.b.autoPicked).toBe(true);
  });

  it('gives each side its own picks most-recent-first, for cooldown captions', () => {
    const frames = buildReplay(
      state([round(1, 'rock', 'paper', 'b'), round(2, 'scissors', 'rock', 'a')]),
    ).frames;
    expect(frames[0].a.recentMoves).toEqual([]);
    expect(frames[1].a.recentMoves).toEqual(['rock']);
    expect(frames[1].b.recentMoves).toEqual(['paper']);
  });
});
