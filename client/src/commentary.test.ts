import { describe, expect, it } from 'vitest';
import type { Loadout } from '@game/helpers/loadout';
import type { MatchState, Move, RoundResult, Seat } from './api';
import {
  RULE_CARDS,
  calloutsFor,
  lookahead,
  narrateRound,
  ruleCardSchedule,
  type RuleCardId,
} from './commentary';
import { ALL_MOVES } from './moves';
import { buildReplay, type Replay } from './replay';

/**
 * Frames come from `buildReplay` rather than being hand-built: the commentary
 * reads cooldown state, and a fixture that made its own would be free to
 * invent one the game can never actually reach.
 */
function seat(
  position: number,
  seatKey: string,
  playerId: string,
  name: string,
  loadout: Loadout | null = null,
): Seat {
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
    loadout,
    loadoutRoll: null,
  };
}

function round(n: number, a: Move, b: Move, outcome: string): RoundResult {
  return { round: n, outcome, moves: { pa: a, pb: b }, autoPicked: [] };
}

function state(
  results: RoundResult[],
  overrides: Partial<MatchState['match']> = {},
  seats: Seat[] = [seat(0, 'a', 'pa', 'Ana'), seat(1, 'b', 'pb', 'Ben')],
): MatchState {
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
    seats,
    results,
    submittedPlayerIds: [],
    currentRoundMoves: {},
    matchWinnerSeatKey: overrides.winnerSeatKey ?? 'a',
    abilityFirings: [],
    serverNow: '2026-09-07T00:05:00.000Z',
  };
}

function replayOf(
  results: RoundResult[],
  overrides: Partial<MatchState['match']> = {},
  seats?: Seat[],
): Replay {
  return buildReplay(state(results, overrides, seats));
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

  it('reads reachable off playability, not marks, so a marked-but-played safe move is not called missed (JQ-215)', () => {
    // Same position as the test above — Ana's Lizard is safe entering round
    // 3, and she plays it — but here her own board is fully marked when she
    // does, with Rock and Lizard tied for fewest. `reachable` used to ask
    // `delaysBefore.lizard === 0`, which is false here, and the round would
    // then be reported as "Lizard was the one move Ben had no answer to, and
    // it was resting for Ana" — false on its face, since Ana played it.
    const replay = replayOf([
      round(1, 'paper', 'rock', 'a'),
      round(2, 'rock', 'scissors', 'a'),
      round(3, 'lizard', 'paper', 'a'),
    ]);
    const frame = replay.frames[2];
    expect(frame.a.safeMoves).toContain('lizard');
    expect(frame.a.move).toBe('lizard');
    frame.a.delaysBefore = { rock: 1, paper: 3, scissors: 4, lizard: 1, robot: 4 };

    const notes = calloutsFor(frame, replay);
    expect(notes.some((n) => n.kind === 'safe-out-of-reach')).toBe(false);
    expect(notes).toContainEqual({
      kind: 'safe-pick',
      text:
        'Rock crushes Lizard and Scissors decapitates it, but Ben had both resting — ' +
        "nothing could beat Ana's Lizard. The only answer left was Lizard back for the " +
        'draw, and Ana still held Rock, which beats that: the strongest edge this ' +
        'game offers.',
    });
  });
});

describe('calloutsFor cooldowns', () => {
  it('names the round the pick comes back rather than how long it rests', () => {
    // Played in round 1, so it enters round 2 on 2 marks, round 3 on 1, and is
    // live again in round 4 — a number that can be checked against the strip.
    const replay = replayOf([
      round(1, 'rock', 'paper', 'b'),
      round(2, 'scissors', 'rock', 'b'),
      round(3, 'paper', 'lizard', 'b'),
      round(4, 'rock', 'scissors', 'a'),
      round(5, 'lizard', 'robot', 'a'),
    ]);
    expect(calloutsFor(replay.frames[0], replay)).toContainEqual({
      kind: 'cooldown',
      text: "Ben's Paper is back in round 4.",
    });
  });

  it('says a rest outlasts the match rather than naming a round nobody sees', () => {
    const replay = replayOf([round(1, 'rock', 'paper', 'b')]);
    expect(calloutsFor(replay.frames[0], replay)).toContainEqual({
      kind: 'cooldown',
      text: "Ben's Paper is out for the rest of the match.",
    });
  });

  it('covers both players in one line when they played the same move', () => {
    const replay = replayOf([
      round(1, 'rock', 'rock', 'draw'),
      round(2, 'paper', 'scissors', 'b'),
      round(3, 'scissors', 'paper', 'a'),
      round(4, 'rock', 'rock', 'draw'),
    ]);
    expect(calloutsFor(replay.frames[0], replay)).toContainEqual({
      kind: 'cooldown',
      text: 'Rock is back for both in round 4.',
    });
  });

  it('says a shared rest outlasts the match when it does', () => {
    const replay = replayOf([round(1, 'rock', 'rock', 'draw')]);
    expect(calloutsFor(replay.frames[0], replay)).toContainEqual({
      kind: 'cooldown',
      text: 'Neither plays Rock again this match.',
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
    const placed = ruleCardSchedule(long).filter((id): id is RuleCardId => id !== null);
    expect(placed).toEqual(['three', 'cooldown', 'unlock', 'safe']);
  });

  it('never lands two cards on the same round', () => {
    const schedule = ruleCardSchedule(long);
    expect(schedule.length).toBe(long.frames.length);
    expect(new Set(schedule.filter(Boolean)).size).toBe(schedule.filter(Boolean).length);
  });

  it('waits for a played move to actually be resting before explaining cooldowns', () => {
    // Round 1 is played into the opening state, where nothing has been played
    // yet — the lock on lizard and robot there is the starting one, so round
    // one carries the rule that is true of every round instead.
    expect(ruleCardSchedule(long)[0]).toBe('three');
    expect(ruleCardSchedule(long)[1]).toBe('cooldown');
  });

  it('leaves out the safe-move card when no move was ever safe', () => {
    const short = replayOf([round(1, 'rock', 'paper', 'b'), round(2, 'scissors', 'rock', 'b')]);
    expect(ruleCardSchedule(short)).not.toContain('safe');
  });

  it('always has a rule for round one, which demonstrates none of the others', () => {
    const short = replayOf([round(1, 'rock', 'paper', 'b')]);
    expect(ruleCardSchedule(short)).toEqual(['three']);
  });

  it('has copy for every card it can schedule', () => {
    for (const id of ruleCardSchedule(long)) {
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

  it('withholds the trap line when the floor leaves them an answer (JQ-215)', () => {
    // The trap check asks what Ana's Rock beats — Scissors and Lizard — and
    // whether Ben can play either. Every move marked, with Paper and Lizard
    // tied for fewest, so the floor keeps Lizard playable for Ben: it stays
    // silent because Ben has an answer, not because anything beats Rock.
    const replay = replayOf([round(1, 'rock', 'paper', 'b')]);
    replay.frames[0].b.delaysBefore = {
      rock: 2,
      paper: 1,
      scissors: 3,
      lizard: 1,
      robot: 4,
    };
    const notes = calloutsFor(replay.frames[0], replay);
    expect(notes.some((n) => n.kind === 'trap')).toBe(false);
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

/**
 * The tempo fixture, chosen because both halves of the idea land in it.
 *
 * Round 2: Ben's Scissors takes the round and is the last thing he held that
 * beat Lizard, so round 3 arrives with Lizard unanswerable.
 * Round 3: Ana punishes with Scissors — and Scissors was the move that made
 * her own Lizard worth holding, so round 4 comes back even.
 * Round 4 is the last frame, so nothing looks past it.
 */
const TEMPO = [
  round(1, 'rock', 'rock', 'draw'),
  round(2, 'paper', 'scissors', 'b'),
  round(3, 'scissors', 'paper', 'a'),
  round(4, 'rock', 'rock', 'draw'),
];

describe('lookahead', () => {
  it('applies exactly one round to each side, and no more', () => {
    const replay = replayOf(TEMPO);
    const frame = replay.frames[1];
    const ahead = lookahead(frame);
    expect(ahead.round).toBe(frame.round + 1);
    // The pick is charged, everything else counts down: the server's rule,
    // borrowed rather than restated.
    expect(ahead.b.scissors).toBe(2);
    expect(ahead.b.paper).toBe(frame.b.delaysBefore.paper);
    expect(ahead.a.rock).toBe(Math.max(0, frame.a.delaysBefore.rock - 1));
  });

  it('leaves both sides holding three moves, the way every round does', () => {
    const replay = replayOf(TEMPO);
    for (const frame of replay.frames) {
      const ahead = lookahead(frame);
      for (const hand of [ahead.a, ahead.b]) {
        expect(ALL_MOVES.filter((m) => hand[m] === 0)).toHaveLength(3);
      }
    }
  });

  it('values the round it projects, not the one on screen', () => {
    const replay = replayOf(TEMPO);
    // Round 3 is Ana's by a third of a win; the round 2 it follows is not.
    expect(lookahead(replay.frames[1]).value).toBeCloseTo(1 / 3);
    expect(lookahead(replay.frames[2]).value).toBeCloseTo(0);
  });
});

describe('calloutsFor tempo', () => {
  it('names what a pick leaves its player with no answer to next round', () => {
    const replay = replayOf(TEMPO);
    expect(calloutsFor(replay.frames[1], replay)).toContainEqual({
      kind: 'tempo-gap',
      text:
        "Ben's Scissors takes the round — and leaves them with nothing that beats " +
        'Lizard in round 3.',
    });
  });

  it('says the same of a pick that lost the round, without second-guessing it', () => {
    const replay = replayOf([
      round(1, 'rock', 'rock', 'draw'),
      round(2, 'paper', 'paper', 'draw'),
      round(3, 'scissors', 'lizard', 'a'),
      round(4, 'rock', 'rock', 'draw'),
    ]);
    expect(calloutsFor(replay.frames[2], replay)).toContainEqual({
      kind: 'tempo-gap',
      text:
        "Ben's Lizard loses the round — and leaves them with nothing that beats Robot " +
        'in round 4.',
    });
  });

  it('names a move coming back to the other player that this one cannot answer', () => {
    const replay = replayOf([
      round(1, 'rock', 'rock', 'draw'),
      round(2, 'paper', 'paper', 'draw'),
      round(3, 'scissors', 'robot', 'b'),
      round(4, 'rock', 'rock', 'draw'),
    ]);
    expect(calloutsFor(replay.frames[2], replay)).toContainEqual({
      kind: 'tempo-return',
      text: "Ana's Rock is back in round 4 — and Ben will be holding nothing that beats it.",
    });
  });

  it('names what spending the answer to the mirror cost', () => {
    const replay = replayOf(TEMPO);
    const kinds = calloutsFor(replay.frames[2], replay).map((c) => c.kind);
    // The round was won on the punish, and the punish is what it cost.
    expect(kinds).toContain('punish');
    expect(calloutsFor(replay.frames[2], replay)).toContainEqual({
      kind: 'tempo-punish-spent',
      text: "Scissors was Ana's answer to Lizard — spending it leaves round 4 an even one.",
    });
  });

  it('stays quiet when the round it hands over is worth nothing to anybody', () => {
    const replay = replayOf(TEMPO);
    // Ana's Rock is the last thing she holds that beats Scissors, so round 2
    // does arrive with Scissors unanswerable — but round 2 is dead even, so
    // the mirror draws it and the gap costs her nothing worth a note.
    expect(lookahead(replay.frames[0]).value).toBeCloseTo(0);
    expect(calloutsFor(replay.frames[0], replay).some((c) => c.kind.startsWith('tempo-'))).toBe(
      false,
    );
  });

  it('never looks past the last round the match actually played', () => {
    const replay = replayOf(TEMPO);
    const last = replay.frames[replay.frames.length - 1];
    // There is a projection, and it is lopsided — but round 5 never happened.
    expect(lookahead(last).value).toBeCloseTo(-1 / 3);
    expect(calloutsFor(last, replay).some((c) => c.kind.startsWith('tempo-'))).toBe(false);
  });

  it('competes for the strategy cap without displacing the bookkeeping', () => {
    const replay = replayOf(TEMPO);
    const callouts = calloutsFor(replay.frames[1], replay);
    const insights = callouts.filter((c) => c.kind !== 'cooldown' && c.kind !== 'match-point');
    expect(insights.length).toBeLessThanOrEqual(2);
    expect(insights.map((c) => c.kind)).toContain('tempo-gap');
    expect(callouts.map((c) => c.kind)).toContain('cooldown');
  });
});

describe('commentary at a helpers match', () => {
  /** Ana brought Copycat, so a drawn round costs her move 1 mark instead of 2. */
  const copycatSeats = (): Seat[] => [
    seat(0, 'a', 'pa', 'Ana', ['copycat', 'poker-face']),
    seat(1, 'b', 'pb', 'Ben'),
  ];

  /** Ana brought Tempered, so the move she wins with rests 3 rounds, not 2. */
  const temperedSeats = (): Seat[] => [
    seat(0, 'a', 'pa', 'Ana', ['tempered', 'poker-face']),
    seat(1, 'b', 'pb', 'Ben'),
  ];

  it('does not claim a drawn move comes back for both when only one paid full price', () => {
    const replay = replayOf(
      [
        round(1, 'rock', 'rock', 'draw'),
        round(2, 'paper', 'paper', 'draw'),
        round(3, 'scissors', 'scissors', 'draw'),
        round(4, 'lizard', 'lizard', 'draw'),
      ],
      {},
      copycatSeats(),
    );
    const cooldown = calloutsFor(replay.frames[0], replay).find((c) => c.kind === 'cooldown');

    expect(cooldown?.text).not.toContain('for both');
    // Copycat charges her Rock 1, so it is live again in round 3; his takes the
    // full 2 and is not. One sentence cannot honestly name a single round.
    expect(cooldown?.text).toBe("Ana's Rock is back in round 3, Ben's in round 4.");
  });

  it('counts a winning move back from what that player actually paid for it', () => {
    const replay = replayOf(
      [
        round(1, 'rock', 'scissors', 'a'),
        round(2, 'paper', 'scissors', 'b'),
        round(3, 'lizard', 'lizard', 'draw'),
        round(4, 'scissors', 'rock', 'b'),
        round(5, 'paper', 'robot', 'a'),
      ],
      {},
      temperedSeats(),
    );
    const cooldown = calloutsFor(replay.frames[0], replay).find((c) => c.kind === 'cooldown');

    // Tempered prices a win at 3 marks, so Rock is out a round longer than the
    // duel arithmetic would have said.
    expect(cooldown?.text).toBe("Ana's Rock is back in round 5.");
  });

  it('withholds the rule cards whose copy states a duel’s own numbers', () => {
    const replay = replayOf(
      [round(1, 'rock', 'paper', 'b'), round(2, 'paper', 'rock', 'a')],
      {},
      copycatSeats(),
    );
    expect(ruleCardSchedule(replay)).not.toContain('unlock');
  });

  it('does not tell a helpers watcher that every move rests exactly 2 rounds', () => {
    const replay = replayOf(
      [round(1, 'rock', 'paper', 'b'), round(2, 'paper', 'rock', 'a')],
      {},
      copycatSeats(),
    );
    const shown = ruleCardSchedule(replay)
      .filter((id): id is RuleCardId => id !== null)
      .map((id) => RULE_CARDS[id].body);

    expect(shown).not.toContain('Every move you play goes on cooldown for 2 rounds');
  });
});
