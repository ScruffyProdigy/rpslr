import { describe, expect, it } from 'vitest';
import { DUEL_RULES, rollFor, rulesFor } from './rules.js';
import { BEATS, INITIAL_DELAYS, replayMatch, type Move, type PlayerOutcome } from '../game.js';
import type { Loadout } from './loadout.js';

/** A Trinket with no engine effect, so a test isolates the card it is paired with. */
const INERT = 'old-habits';

const load = (id: string): Loadout => [id, INERT] as Loadout;

const cost = (loadout: Loadout, move: Move, outcome: PlayerOutcome, roundIndex = 2) =>
  rulesFor(loadout).delayOnChoice({ move, outcome, roundIndex });

const outcome = (
  loadout: Loadout,
  raw: PlayerOutcome,
  ctx: { own: Move; opponent: Move; roundIndex?: number; lossesSoFar?: number },
) =>
  rulesFor(loadout).transformOutcome(raw, {
    own: ctx.own,
    opponent: ctx.opponent,
    roundIndex: ctx.roundIndex ?? 0,
    lossesSoFar: ctx.lossesSoFar ?? 0,
  });

const marks = (
  loadout: Loadout,
  ctx: { own: Move; opponent: Move; outcome: PlayerOutcome; lossesSoFar?: number },
) =>
  rulesFor(loadout).adjustAfterRound({
    own: ctx.own,
    opponent: ctx.opponent,
    outcome: ctx.outcome,
    roundIndex: 1,
    lossesSoFar: ctx.lossesSoFar ?? 0,
  });

describe('duel is the null loadout', () => {
  it('reproduces duel exactly', () => {
    expect(DUEL_RULES.initialDelays).toEqual(INITIAL_DELAYS);
    expect(DUEL_RULES.delayOnChoice({ move: 'rock', outcome: 'win', roundIndex: 0 })).toBe(2);
    expect(DUEL_RULES.delayOnChoice({ move: 'robot', outcome: 'loss', roundIndex: 4 })).toBe(2);
    expect(DUEL_RULES.beats.lizard).toEqual(['robot', 'paper']);
    expect(DUEL_RULES.rolledMove).toBeNull();
  });

  it('is what rulesFor returns for no loadout at all', () => {
    expect(rulesFor(null)).toBe(DUEL_RULES);
  });
});

describe('rulesFor — opening marks', () => {
  it('prices the opening from the loadout, not the duel constants', () => {
    expect(rulesFor(['ferrus', 'copycat']).initialDelays).toEqual({
      rock: 0, paper: 0, scissors: 0, lizard: 0, robot: 2,
    });
    expect(rulesFor(['copycat', 'watchful']).initialDelays).toEqual({
      rock: 0, paper: 0, scissors: 0, lizard: 0, robot: 0,
    });
  });

  it('carries the stored roll through, rather than rolling again', () => {
    const rules = rulesFor(['grudge', 'sharp-practice'], { roll: 'lizard' });
    expect(rules.rolledMove).toBe('lizard');
    expect(rules.initialDelays).toEqual({
      rock: 0, paper: 0, scissors: 1, lizard: 1, robot: 0,
    });
  });

  it('refuses to build a colliding loadout with no roll to place', () => {
    expect(() => rulesFor(['grudge', 'sharp-practice'])).toThrow(/roll/i);
  });

  it('rolls once, for storing, and only where there is a collision', () => {
    expect(rollFor(['grudge', 'sharp-practice'], (c) => c[0])).not.toBeNull();
    expect(rollFor(['ferrus', 'copycat'], (c) => c[0])).toBeNull();
    expect(rollFor(null, (c) => c[0])).toBeNull();
  });
});

describe('Chimera — a sixth edge, for its owner only', () => {
  it('adds lizard beats scissors without touching the shared graph', () => {
    expect(rulesFor(load('chimera')).beats.lizard).toEqual(['robot', 'paper', 'scissors']);
    expect(BEATS.lizard).toEqual(['robot', 'paper']);
    expect(DUEL_RULES.beats.lizard).toEqual(['robot', 'paper']);
  });

  it('leaves every other row of the graph alone', () => {
    const rules = rulesFor(load('chimera'));
    for (const move of ['rock', 'paper', 'scissors', 'robot'] as const) {
      expect(rules.beats[move], move).toEqual(BEATS[move]);
    }
  });
});

describe('Ferrus — playing Robot marks what they played', () => {
  it('marks their move whenever you play robot, win or lose', () => {
    expect(marks(load('ferrus'), { own: 'robot', opponent: 'paper', outcome: 'loss' })).toEqual({
      own: {},
      opponent: { paper: 1 },
    });
    expect(marks(load('ferrus'), { own: 'robot', opponent: 'scissors', outcome: 'win' })).toEqual({
      own: {},
      opponent: { scissors: 1 },
    });
  });

  it('does nothing on any other move of yours', () => {
    expect(marks(load('ferrus'), { own: 'rock', opponent: 'paper', outcome: 'loss' })).toEqual({
      own: {},
      opponent: {},
    });
  });

  it('no longer discounts robot — that effect moved off this card', () => {
    expect(cost(load('ferrus'), 'robot', 'win')).toBe(2);
  });

  it('stacks with a second card marking the same move', () => {
    expect(marks(['ferrus', 'grudge'], { own: 'robot', opponent: 'paper', outcome: 'loss' })).toEqual(
      { own: {}, opponent: { paper: 2 } },
    );
  });
});

describe('Featherweight — Lizard takes 1', () => {
  it('discounts lizard and nothing else', () => {
    expect(cost(load('featherweight'), 'lizard', 'win')).toBe(1);
    expect(cost(load('featherweight'), 'robot', 'win')).toBe(2);
  });
});

describe('Tempered — 3 for a win, 1 for a loss', () => {
  it('charges by outcome', () => {
    expect(cost(load('tempered'), 'rock', 'win')).toBe(3);
    expect(cost(load('tempered'), 'rock', 'loss')).toBe(1);
    expect(cost(load('tempered'), 'rock', 'draw')).toBe(2);
  });
});

describe('Copycat — a drawn round costs 1', () => {
  it('discounts a draw only', () => {
    expect(cost(load('copycat'), 'rock', 'draw')).toBe(1);
    expect(cost(load('copycat'), 'rock', 'win')).toBe(2);
    expect(cost(load('copycat'), 'rock', 'loss')).toBe(2);
  });
});

describe('Echo Chamber — a draw costs you nothing and them extra', () => {
  it('charges your move nothing on a draw', () => {
    expect(cost(load('echo-chamber'), 'rock', 'draw')).toBe(0);
    expect(cost(load('echo-chamber'), 'rock', 'win')).toBe(2);
  });

  it('puts an extra mark on their move on a draw', () => {
    expect(marks(load('echo-chamber'), { own: 'rock', opponent: 'rock', outcome: 'draw' })).toEqual(
      { own: {}, opponent: { rock: 1 } },
    );
    expect(marks(load('echo-chamber'), { own: 'rock', opponent: 'paper', outcome: 'loss' })).toEqual(
      { own: {}, opponent: {} },
    );
  });
});

describe('Bookend — your first move of the match costs 1', () => {
  it('discounts round 0 only', () => {
    expect(cost(load('bookend'), 'rock', 'win', 0)).toBe(1);
    expect(cost(load('bookend'), 'rock', 'win', 1)).toBe(2);
  });

  it('wins over a surcharge rather than stacking with it', () => {
    expect(cost(['bookend', 'tempered'], 'rock', 'win', 0)).toBe(1);
    expect(cost(['bookend', 'tempered'], 'rock', 'win', 1)).toBe(3);
  });
});

describe('Good Old Rock — a Rock loss becomes a draw', () => {
  it('spares a loss on rock, and no other loss', () => {
    expect(outcome(load('good-old-rock'), 'loss', { own: 'rock', opponent: 'paper' })).toBe('draw');
    expect(outcome(load('good-old-rock'), 'loss', { own: 'paper', opponent: 'scissors' })).toBe(
      'loss',
    );
  });

  it('does not turn a win into anything else', () => {
    expect(outcome(load('good-old-rock'), 'win', { own: 'rock', opponent: 'scissors' })).toBe('win');
  });

  it('keeps working all match, not just the first time', () => {
    expect(
      outcome(load('good-old-rock'), 'loss', { own: 'rock', opponent: 'paper', lossesSoFar: 3 }),
    ).toBe('draw');
  });
});

describe('Sharp Practice — the Scissors mirror is a win', () => {
  it('converts only the scissors mirror', () => {
    expect(
      outcome(load('sharp-practice'), 'draw', { own: 'scissors', opponent: 'scissors' }),
    ).toBe('win');
    expect(outcome(load('sharp-practice'), 'draw', { own: 'rock', opponent: 'rock' })).toBe('draw');
  });
});

describe('Second Wind — the first loss is a draw', () => {
  it('saves the first loss and no later one', () => {
    expect(
      outcome(load('second-wind'), 'loss', {
        own: 'paper',
        opponent: 'scissors',
        roundIndex: 1,
        lossesSoFar: 0,
      }),
    ).toBe('draw');
    expect(
      outcome(load('second-wind'), 'loss', {
        own: 'paper',
        opponent: 'scissors',
        roundIndex: 3,
        lossesSoFar: 1,
      }),
    ).toBe('loss');
  });
});

describe('Grudge — the move that beat you takes an extra mark', () => {
  it('marks their move every time you lose', () => {
    expect(marks(load('grudge'), { own: 'paper', opponent: 'scissors', outcome: 'loss' })).toEqual({
      own: {},
      opponent: { scissors: 1 },
    });
    expect(
      marks(load('grudge'), { own: 'paper', opponent: 'scissors', outcome: 'loss', lossesSoFar: 2 }),
    ).toEqual({ own: {}, opponent: { scissors: 1 } });
  });

  it('does nothing on a win or a draw', () => {
    expect(marks(load('grudge'), { own: 'rock', opponent: 'scissors', outcome: 'win' })).toEqual({
      own: {},
      opponent: {},
    });
  });
});

describe('Small Mercy — the first move that beats you takes an extra mark', () => {
  it('fires on the first loss only', () => {
    expect(
      marks(load('small-mercy'), { own: 'paper', opponent: 'scissors', outcome: 'loss' }),
    ).toEqual({ own: {}, opponent: { scissors: 1 } });
    expect(
      marks(load('small-mercy'), {
        own: 'paper',
        opponent: 'scissors',
        outcome: 'loss',
        lossesSoFar: 1,
      }),
    ).toEqual({ own: {}, opponent: {} });
  });
});

describe('Grudge and Small Mercy together stack on the same move', () => {
  it('adds both marks rather than one overwriting the other', () => {
    expect(
      marks(['grudge', 'small-mercy'], { own: 'paper', opponent: 'scissors', outcome: 'loss' }),
    ).toEqual({ own: {}, opponent: { scissors: 2 } });
  });
});

describe('the helpers that only change what a player is shown', () => {
  it('Poker Face hides that you locked in', () => {
    expect(rulesFor(load('poker-face')).disclosure.hidesLockIn).toBe(true);
    expect(DUEL_RULES.disclosure.hidesLockIn).toBe(false);
  });

  it('Blind Spot hides the move its holder named at the draft', () => {
    // The design doc is explicit: "At draft, name one of your moves". Not the
    // robot it is bound to — any of the five.
    expect(rulesFor(load('blind-spot'), { blindSpot: 'paper' }).disclosure.hiddenCooldown).toBe(
      'paper',
    );
    expect(rulesFor(load('blind-spot'), { blindSpot: 'robot' }).disclosure.hiddenCooldown).toBe(
      'robot',
    );
    expect(DUEL_RULES.disclosure.hiddenCooldown).toBeNull();
  });

  it('refuses a Blind Spot with no named move, rather than hiding nothing', () => {
    expect(() => rulesFor(load('blind-spot'))).toThrow(/named at the draft/i);
    expect(() => rulesFor(load('blind-spot'), { blindSpot: 'trebuchet' as Move })).toThrow(
      /not a move/i,
    );
  });

  it('ignores a named move when nobody is holding Blind Spot', () => {
    expect(rulesFor(load('poker-face'), { blindSpot: 'paper' }).disclosure.hiddenCooldown).toBeNull();
  });

  it('Old Habits shows you their most-played move', () => {
    expect(rulesFor(['old-habits', 'copycat']).disclosure.showsOpponentMostPlayed).toBe(true);
  });

  it('Watchful shows you their cooldowns as they will stand', () => {
    expect(rulesFor(['watchful', 'copycat']).disclosure.showsOpponentNextCooldowns).toBe(true);
  });

  it('leaves the cooldown arithmetic alone', () => {
    for (const id of ['poker-face', 'blind-spot', 'old-habits', 'watchful']) {
      // A loadout is two *distinct* helpers, so the inert partner has to differ.
      const pair = [id, id === INERT ? 'watchful' : INERT] as Loadout;
      const rules = rulesFor(pair, { blindSpot: 'paper' });
      expect(rules.delayOnChoice({ move: 'rock', outcome: 'win', roundIndex: 2 }), id).toBe(2);
      expect(
        rules.transformOutcome('loss', {
          own: 'rock',
          opponent: 'paper',
          roundIndex: 0,
          lossesSoFar: 0,
        }),
        id,
      ).toBe('loss');
    }
  });
});

describe('the helpers whose effects are not implemented yet', () => {
  it('are still legal to hold, and change nothing beyond their opening marks', () => {
    // Quarantine is per-round and the four charge Majors are gated on the resize
    // sign-off (JQ-146 Task 1.0). They must not silently do something in the
    // meantime, so a loadout holding one plays as its opening marks and no more.
    for (const id of ['quarantine', 'oracle', 'sacrifice', 'rust', 'thief', 'freeze']) {
      const rules = rulesFor(load(id));
      expect(cost(load(id), 'rock', 'win'), id).toBe(2);
      expect(rules.beats, id).toEqual(BEATS);
      expect(outcome(load(id), 'loss', { own: 'rock', opponent: 'paper' }), id).toBe('loss');
      expect(marks(load(id), { own: 'rock', opponent: 'paper', outcome: 'loss' }), id).toEqual({
        own: {},
        opponent: {},
      });
    }
  });
});

describe('the stacking pairs the design doc says to watch', () => {
  // Both bound to Rock, so they collide and are now draftable together. Both turn
  // a loss into a draw, and the doc calls this "the pairing to check first".
  it('Good Old Rock spares a Rock loss without spending Second Wind', () => {
    const rules = rulesFor(['good-old-rock', 'second-wind'], { roll: 'paper' });
    const rockLoss = { own: 'rock' as Move, opponent: 'paper' as Move, roundIndex: 0, lossesSoFar: 0 };
    expect(rules.transformOutcome('loss', rockLoss)).toBe('draw');
    // Because that never became a loss, Second Wind is still armed for the next one.
    const laterLoss = { own: 'paper' as Move, opponent: 'scissors' as Move, roundIndex: 2, lossesSoFar: 0 };
    expect(rules.transformOutcome('loss', laterLoss)).toBe('draw');
    // And once Second Wind has genuinely been spent, losses land.
    expect(rules.transformOutcome('loss', { ...laterLoss, lossesSoFar: 1 })).toBe('loss');
  });

  it('Copycat and Good Old Rock together cool Rock every other round, not every third', () => {
    const rules = rulesFor(['good-old-rock', 'copycat'], {});
    // The Rock loss becomes a draw, and a drawn round charges Rock 1 instead of 2.
    const asDraw = rules.transformOutcome('loss', {
      own: 'rock',
      opponent: 'paper',
      roundIndex: 1,
      lossesSoFar: 0,
    });
    expect(asDraw).toBe('draw');
    expect(rules.delayOnChoice({ move: 'rock', outcome: asDraw, roundIndex: 1 })).toBe(1);
    // Rock opens on 2 marks for a Good Old Rock holder, so the soonest it can be
    // played is round 2. Charged 1 instead of 2, it is live again the round after
    // that — back every other round rather than every third.
    const sequence = [
      { a: 'paper' as Move, b: 'rock' as Move },
      { a: 'rock' as Move, b: 'paper' as Move },
    ];
    expect(replayMatch(sequence, rules, rulesFor(null)).a.rock).toBe(1);
    // The same two rounds without Copycat leave it down for two.
    expect(replayMatch(sequence, rulesFor(load('good-old-rock')), rulesFor(null)).a.rock).toBe(2);
  });
});
