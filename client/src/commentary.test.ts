import { describe, expect, it } from 'vitest';
import type { MatchState, Move, RoundResult, Seat } from './api';
import {
  RULE_CARDS,
  calloutsFor,
  narrateRound,
  ruleCardSchedule,
  type RuleCardId,
} from './commentary';
import { buildReplay, type Replay } from './replay';

/**
 * Frames come from `buildReplay` rather than being hand-built: the commentary
 * reads cooldown state, and a fixture that made its own would be free to
 * invent one the game can never actually reach.
 */
function seat(position: number, seatKey: string, playerId: string, name: string): Seat {
  return {
    id: `seat-${seatKey}`,
    matchId: 'm1',
    seatKey,
    teamKey: null,
    role: null,
    position,
    reservedForLobbyUser: null,
    player: { id: playerId, name, lobbyUserId: null, score: 0, profile: null, expiryStrikes: 0 },
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

function replayOf(results: RoundResult[], overrides: Partial<MatchState['match']> = {}): Replay {
  return buildReplay(state(results, overrides));
}

/** Narration for the nth round (1-based) of a replay. */
function narrate(replay: Replay, n: number): string {
  return narrateRound(replay.frames[n - 1], replay);
}

describe('narrateRound', () => {
  it('names both picks, the edge between them, and the score after', () => {
    const replay = replayOf([round(1, 'rock', 'paper', 'b')]);
    expect(narrate(replay, 1)).toBe(
      'Ana plays Rock, Ben plays Paper — Paper covers Rock. Ben leads 1–0.',
    );
  });

  it('reads a mirror round as a draw with no winner', () => {
    const replay = replayOf([round(1, 'rock', 'rock', 'draw')]);
    expect(narrate(replay, 1)).toBe('Both play Rock — no winner. No score yet.');
  });

  it('says the score is level when nobody is ahead', () => {
    const replay = replayOf([round(1, 'rock', 'paper', 'b'), round(2, 'scissors', 'paper', 'a')]);
    expect(narrate(replay, 2)).toBe(
      'Ana plays Scissors, Ben plays Paper — Scissors cuts Paper. Level at 1–1.',
    );
  });

  it('calls the match when the round that just went by settled it', () => {
    const replay = replayOf([
      round(1, 'rock', 'scissors', 'a'),
      round(2, 'paper', 'rock', 'a'),
      round(3, 'scissors', 'paper', 'a'),
    ]);
    expect(narrate(replay, 3)).toBe(
      'Ana plays Scissors, Ben plays Paper — Scissors cuts Paper. Ana wins the match 3–0.',
    );
  });

  it('still only leads when a match ended without anyone reaching the target', () => {
    const replay = replayOf([round(1, 'rock', 'scissors', 'a')], { endReason: 'abandoned' });
    expect(narrate(replay, 1)).toContain('Ana leads 1–0.');
  });
});

describe('calloutsFor safe picks', () => {
  it('explains a move nothing live could answer, naming both attackers', () => {
    // Ben opens Rock then Scissors, which are exactly the two moves that beat
    // Lizard — so entering round 3 both are resting and Ana's Lizard cannot
    // lose.
    const replay = replayOf([
      round(1, 'paper', 'rock', 'a'),
      round(2, 'rock', 'scissors', 'a'),
      round(3, 'lizard', 'paper', 'a'),
    ]);
    const frame = replay.frames[2];
    expect(frame.a.safeMoves).toContain('lizard');
    expect(calloutsFor(frame, replay)).toContainEqual({
      kind: 'safe-pick',
      text:
        'Rock crushes Lizard and Scissors decapitates it, but Ben had both on cooldown ' +
        "— nothing could beat Ana's Lizard. A safe pick.",
    });
  });

  it('says nothing about safety when every attacker was still live', () => {
    const replay = replayOf([round(1, 'rock', 'paper', 'b')]);
    expect(calloutsFor(replay.frames[0], replay).some((c) => c.kind === 'safe-pick')).toBe(false);
  });
});

describe('calloutsFor cooldowns', () => {
  it("puts the winner's move out for the two rounds it now rests", () => {
    const replay = replayOf([round(1, 'rock', 'paper', 'b')]);
    expect(calloutsFor(replay.frames[0], replay)).toContainEqual({
      kind: 'cooldown',
      text: "Ben's Paper is now out for 2 rounds.",
    });
  });

  it('covers both players in one line when they played the same move', () => {
    const replay = replayOf([round(1, 'rock', 'rock', 'draw')]);
    expect(calloutsFor(replay.frames[0], replay)).toContainEqual({
      kind: 'cooldown',
      text: 'Neither can play Rock for the next 2 rounds.',
    });
  });
});

describe('calloutsFor match point', () => {
  it('flags the round that leaves someone one win short', () => {
    const replay = replayOf([round(1, 'rock', 'scissors', 'a'), round(2, 'paper', 'rock', 'a')]);
    expect(calloutsFor(replay.frames[1], replay)).toContainEqual({
      kind: 'match-point',
      text: 'Match point for Ana.',
    });
  });

  it('flags both players when they are level one win short', () => {
    const replay = replayOf([
      round(1, 'rock', 'scissors', 'a'),
      round(2, 'paper', 'rock', 'a'),
      round(3, 'scissors', 'rock', 'b'),
      round(4, 'rock', 'paper', 'b'),
    ]);
    expect(calloutsFor(replay.frames[3], replay)).toContainEqual({
      kind: 'match-point',
      text: 'Match point for both players.',
    });
  });

  it('does not call match point on the round that won the match', () => {
    const replay = replayOf([
      round(1, 'rock', 'scissors', 'a'),
      round(2, 'paper', 'rock', 'a'),
      round(3, 'scissors', 'paper', 'a'),
    ]);
    expect(calloutsFor(replay.frames[2], replay).some((c) => c.kind === 'match-point')).toBe(false);
  });
});

describe('ruleCardSchedule', () => {
  const long = replayOf([
    round(1, 'rock', 'paper', 'b'),
    round(2, 'scissors', 'rock', 'b'),
    round(3, 'paper', 'lizard', 'b'),
    round(4, 'rock', 'scissors', 'a'),
    round(5, 'lizard', 'robot', 'a'),
  ]);

  it('teaches each rule once, in the order a watcher meets it', () => {
    const placed = ruleCardSchedule(long.frames).filter((id): id is RuleCardId => id !== null);
    expect(placed).toEqual(['cooldown', 'unlock', 'safe']);
  });

  it('never lands two cards on the same round', () => {
    const schedule = ruleCardSchedule(long.frames);
    expect(schedule.length).toBe(long.frames.length);
    expect(new Set(schedule.filter(Boolean)).size).toBe(schedule.filter(Boolean).length);
  });

  it('waits for a played move to actually be resting before explaining cooldowns', () => {
    // Round 1 is played into the opening state, where nothing has been played
    // yet — the lock on lizard and robot there is the starting one.
    expect(ruleCardSchedule(long.frames)[0]).toBeNull();
    expect(ruleCardSchedule(long.frames)[1]).toBe('cooldown');
  });

  it('leaves out the safe-move card when no move was ever safe', () => {
    const short = replayOf([round(1, 'rock', 'paper', 'b'), round(2, 'scissors', 'rock', 'b')]);
    expect(ruleCardSchedule(short.frames)).not.toContain('safe');
  });

  it('has copy for every card it can schedule', () => {
    for (const id of ruleCardSchedule(long.frames)) {
      if (id) expect(RULE_CARDS[id].body.length).toBeGreaterThan(0);
    }
  });
});
