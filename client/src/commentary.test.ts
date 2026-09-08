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
        'Rock crushes Lizard and Scissors decapitates it, but Ben had both resting — ' +
        "nothing could beat Ana's Lizard. The only answer left was Lizard back for the " +
        'draw, and Ana still held Scissors, which beats that: the strongest edge this ' +
        'game offers.',
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
    expect(placed).toEqual(['three', 'cooldown', 'unlock', 'safe']);
  });

  it('never lands two cards on the same round', () => {
    const schedule = ruleCardSchedule(long.frames);
    expect(schedule.length).toBe(long.frames.length);
    expect(new Set(schedule.filter(Boolean)).size).toBe(schedule.filter(Boolean).length);
  });

  it('waits for a played move to actually be resting before explaining cooldowns', () => {
    // Round 1 is played into the opening state, where nothing has been played
    // yet — the lock on lizard and robot there is the starting one, so round
    // one carries the rule that is true of every round instead.
    expect(ruleCardSchedule(long.frames)[0]).toBe('three');
    expect(ruleCardSchedule(long.frames)[1]).toBe('cooldown');
  });

  it('leaves out the safe-move card when no move was ever safe', () => {
    const short = replayOf([round(1, 'rock', 'paper', 'b'), round(2, 'scissors', 'rock', 'b')]);
    expect(ruleCardSchedule(short.frames)).not.toContain('safe');
  });

  it('always has a rule for round one, which demonstrates none of the others', () => {
    const short = replayOf([round(1, 'rock', 'paper', 'b')]);
    expect(ruleCardSchedule(short.frames)).toEqual(['three']);
  });

  it('has copy for every card it can schedule', () => {
    for (const id of ruleCardSchedule(long.frames)) {
      if (id) expect(RULE_CARDS[id].body.length).toBeGreaterThan(0);
    }
  });
});

describe('calloutsFor the opening round', () => {
  it('says the game starts as the one everybody already knows', () => {
    const replay = replayOf([round(1, 'rock', 'paper', 'b')]);
    expect(calloutsFor(replay.frames[0], replay)).toContainEqual({
      kind: 'opening',
      text:
        'Nothing has been played yet, so both open with the same three: Rock, Paper and ' +
        'Scissors. Lizard and Robot are still locked.',
    });
  });

  it('drops it as soon as anyone has played', () => {
    const replay = replayOf([round(1, 'rock', 'paper', 'b'), round(2, 'scissors', 'rock', 'b')]);
    expect(calloutsFor(replay.frames[1], replay).some((c) => c.kind === 'opening')).toBe(false);
  });
});

/**
 * Entering round 4 Ben is resting Lizard and Scissors — which are exactly the
 * two moves Rock beats, so Ana's Rock has nothing to win against. The same two
 * resting moves are the pair that beats Paper, so Paper is the move Ben cannot
 * answer at all — and Ana is resting it.
 */
const TRAPPED = [
  round(1, 'rock', 'paper', 'b'),
  round(2, 'paper', 'lizard', 'b'),
  round(3, 'scissors', 'scissors', 'draw'),
  round(4, 'rock', 'rock', 'draw'),
];

describe('calloutsFor a move with nothing left to beat', () => {
  it('says the best that pick could have got was a draw', () => {
    const replay = replayOf(TRAPPED);
    expect(calloutsFor(replay.frames[3], replay)).toContainEqual({
      kind: 'trap',
      text:
        'Rock only beats Scissors and Lizard, and Ben had both on cooldown — the best ' +
        'Ana could get from it was a draw.',
    });
  });

  it('says nothing when the pick still had something to beat', () => {
    const replay = replayOf([round(1, 'rock', 'paper', 'b')]);
    expect(calloutsFor(replay.frames[0], replay).some((c) => c.kind === 'trap')).toBe(false);
  });
});

describe('calloutsFor a safe move out of reach', () => {
  it('names the move the other player could not have answered', () => {
    const replay = replayOf(TRAPPED);
    expect(replay.frames[3].a.safeMoves).toEqual(['paper']);
    expect(replay.frames[3].a.delaysBefore.paper).toBeGreaterThan(0);
    expect(calloutsFor(replay.frames[3], replay)).toContainEqual({
      kind: 'safe-out-of-reach',
      text: 'Paper was the one move Ben had no answer to, and it was resting for Ana.',
    });
  });

  it('says nothing when the safe move was there to be played', () => {
    const replay = replayOf([
      round(1, 'paper', 'rock', 'a'),
      round(2, 'rock', 'scissors', 'a'),
      round(3, 'lizard', 'paper', 'a'),
    ]);
    const kinds = calloutsFor(replay.frames[2], replay).map((c) => c.kind);
    expect(kinds).toContain('safe-pick');
    expect(kinds).not.toContain('safe-out-of-reach');
  });
});

describe('calloutsFor keeps the list readable', () => {
  it('caps the strategy notes but never drops the round bookkeeping', () => {
    const replay = replayOf(TRAPPED);
    const callouts = calloutsFor(replay.frames[3], replay);
    const insights = callouts.filter(
      (c) => c.kind !== 'cooldown' && c.kind !== 'match-point',
    );
    expect(insights).toHaveLength(2);
    expect(callouts.map((c) => c.kind)).toContain('cooldown');
    expect(callouts.map((c) => c.kind)).toContain('match-point');
  });
});

/**
 * Both sides spend Paper and Robot on rounds 4 and 3, so by round 5 they hold
 * the same three moves and Rock is safe for each of them — with neither
 * holding anything that beats a Rock. The mirror is the whole round.
 */
const MIRROR_LOCK = [
  round(1, 'paper', 'paper', 'draw'),
  round(2, 'scissors', 'scissors', 'draw'),
  round(3, 'robot', 'robot', 'draw'),
  round(4, 'paper', 'paper', 'draw'),
  round(5, 'rock', 'rock', 'draw'),
];

/** Ben opens Rock then Scissors, which leaves Ana a safe move every round. */
const SAFE_IN_HAND = [
  round(1, 'paper', 'rock', 'a'),
  round(2, 'rock', 'scissors', 'a'),
];

describe('calloutsFor a safe move nobody can profit from', () => {
  it('says the mirror draws it when there is nothing that beats the safe move', () => {
    const replay = replayOf(MIRROR_LOCK);
    expect(calloutsFor(replay.frames[4], replay)).toContainEqual({
      kind: 'safe-mirror-locked',
      text:
        "Nothing Ben could play beat Ana's Rock — but Rock back draws it, and Ana had " +
        'nothing that beats Rock. Played right, this round was a draw either way.',
    });
  });

  it('says the round was even when neither side had anything to say about it', () => {
    const replay = replayOf(MIRROR_LOCK);
    expect(calloutsFor(replay.frames[2], replay)).toContainEqual({
      kind: 'round-edge',
      text: 'Neither side had an edge going in — played perfectly, this round was a coin flip.',
    });
  });
});

describe('calloutsFor beating the answer to a safe move', () => {
  it('reads the pick as the punish it is, not as a move away from safety', () => {
    // Lizard is the move Ben cannot beat, so his only answer is Lizard back —
    // and Ana holds Scissors, which beats that.
    const replay = replayOf([...SAFE_IN_HAND, round(3, 'scissors', 'paper', 'a')]);
    expect(calloutsFor(replay.frames[2], replay)).toContainEqual({
      kind: 'punish',
      text:
        'Lizard was the one move Ben could not beat, so Lizard is what they had to expect ' +
        '— and Ana played Scissors, which beats it.',
    });
  });

  it('names a safe move that was in hand and passed over', () => {
    const replay = replayOf([...SAFE_IN_HAND, round(3, 'robot', 'paper', 'b')]);
    expect(calloutsFor(replay.frames[2], replay)).toContainEqual({
      kind: 'safe-unplayed',
      text: 'Nothing Ben could play beat Lizard, and Ana had it in hand — the pick was Robot.',
    });
  });

  it('keeps the round-strength note for rounds that had nothing else to say', () => {
    const replay = replayOf([...SAFE_IN_HAND, round(3, 'scissors', 'paper', 'a')]);
    const kinds = calloutsFor(replay.frames[2], replay).map((c) => c.kind);
    expect(kinds).toContain('punish');
    expect(kinds).not.toContain('round-edge');
  });
});
