import { describe, expect, it } from 'vitest';
import { DUEL_RULES, rollFor, rulesFor } from './rules.js';
import { abilityMarks } from './abilities.js';
import {
  BASE_RULES,
  BEATS,
  INITIAL_DELAYS,
  replayMatch,
  resolveRound,
  type Move,
  type PlayerOutcome,
} from '../game.js';
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

  it('Old Habits shows you their most-played move', () => {
    expect(rulesFor(['old-habits', 'copycat']).disclosure.showsOpponentMostPlayed).toBe(true);
  });

  it('Watchful shows you their cooldowns as they will stand', () => {
    expect(rulesFor(['watchful', 'copycat']).disclosure.showsOpponentNextCooldowns).toBe(true);
  });

  it('leaves the cooldown arithmetic alone', () => {
    for (const id of ['poker-face', 'old-habits', 'watchful']) {
      // A loadout is two *distinct* helpers, so the inert partner has to differ.
      const pair = [id, id === INERT ? 'watchful' : INERT] as Loadout;
      const rules = rulesFor(pair);
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

describe('the helper whose effect is not implemented yet', () => {
  it('is still legal to hold, and changes nothing beyond its opening marks', () => {
    // Oracle alone now: it needs a mid-round reveal sub-phase, which is JQ-150.
    // Its marks come from the roster here so JQ-150 inherits the cooldown rather
    // than inventing one. It must not silently do something in the meantime.
    for (const id of ['oracle']) {
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

describe('a loadout hands its ability slots to the engine', () => {
  it('BASE_RULES holds none, so duel is still the identity element', () => {
    expect(BASE_RULES.abilities).toEqual({});
  });

  it('carries what each ability opens on and what firing it costs', () => {
    expect(rulesFor(load('sacrifice')).abilities).toEqual({
      sacrifice: { opening: 3, recharge: 3 },
    });
  });

  it('holds none for a loadout of nothing but passives', () => {
    expect(rulesFor(['ferrus', 'copycat']).abilities).toEqual({});
  });
});

/**
 * The five cooldown abilities, each as a state transition over one round.
 *
 * Driven through `replayMatch` rather than by poking a hook directly, because
 * every one of them is about *when* in the round it lands — before the decrement,
 * after the choice marks — and only the replay puts those in order.
 */
describe('Freeze', () => {
  const fired = (id: string) => [{ id }];

  it("stops the opponent's marks coming off that round", () => {
    const attacker = rulesFor(load('freeze'));
    // Ferrus binds robot, so B opens with 2 marks there to watch.
    const victim = rulesFor(['ferrus', 'copycat']);
    const round = { a: 'rock' as const, b: 'paper' as const };

    const thawed = replayMatch([round], attacker, victim);
    const frozen = replayMatch([{ ...round, firedA: fired('freeze') }], attacker, victim);

    expect(thawed.b.robot).toBe(1);
    expect(frozen.b.robot).toBe(2);
  });

  it("leaves the firer's own marks decrementing as usual", () => {
    // Freeze is itself robot-bound, so its own 2 opening marks are the ones to watch.
    const attacker = rulesFor(load('freeze'));
    const victim = rulesFor(load('copycat'));
    const { a } = replayMatch(
      [{ a: 'rock', b: 'paper', firedA: fired('freeze') }],
      attacker,
      victim,
    );
    // Freeze's own 2 opening marks come off as normal: it reaches across, not down.
    expect(a.robot).toBe(1);
  });
});

describe('Quarantine', () => {
  const attacker = rulesFor(load('quarantine'));
  const victim = rulesFor(load('copycat'));
  const name = (target: Move) => [{ id: 'quarantine', target }];

  it('adds 2 marks to the named move when they play it', () => {
    const { b } = replayMatch(
      [{ a: 'rock', b: 'paper', firedA: name('paper') }],
      attacker,
      victim,
    );
    // Their paper takes its own 2 choice marks, and Quarantine's 2 on top.
    expect(b.paper).toBe(4);
  });

  it('does nothing at all when they play something else', () => {
    const { b } = replayMatch(
      [{ a: 'rock', b: 'paper', firedA: name('lizard') }],
      attacker,
      victim,
    );
    expect(b.lizard).toBe(0);
    expect(b.paper).toBe(2);
  });

  it('spends the charge on a miss just as on a hit', () => {
    const missed = abilityMarks(['quarantine', 'old-habits'], [name('lizard')]);
    expect(missed).toEqual({ quarantine: { marks: 3, available: false } });
  });
});

describe('Rust', () => {
  const attacker = rulesFor(load('rust'));
  // Ferrus binds robot, so B enters the match with one live move and four clear.
  const victim = rulesFor(['ferrus', 'copycat']);
  const at = (target: Move) => [{ id: 'rust', target }];

  it('adds 2 marks to a move they have live', () => {
    const { b } = replayMatch([{ a: 'rock', b: 'paper', firedA: at('robot') }], attacker, victim);
    // robot enters on 2, loses one to the decrement, takes Rust's 2.
    expect(b.robot).toBe(3);
  });

  it('does nothing to a move they have clear — there is no rust to add', () => {
    const { b } = replayMatch([{ a: 'rock', b: 'paper', firedA: at('lizard') }], attacker, victim);
    expect(b.lizard).toBe(0);
  });

  it('reads live as it stands entering the round, not after the decrement', () => {
    // Their robot is on 1 entering round 2, which the decrement would clear. Rust
    // named it while it was still live, so it lands.
    const rounds = [
      { a: 'rock' as const, b: 'paper' as const },
      { a: 'rock' as const, b: 'paper' as const, firedA: at('robot') },
    ];
    const { b } = replayMatch(rounds, attacker, victim);
    expect(b.robot).toBe(2);
  });
});

describe('Thief', () => {
  // Thief binds lizard, so its owner has 2 marks of their own to move.
  const attacker = rulesFor(load('thief'));
  const victim = rulesFor(load('copycat'));
  const steal = (source: Move, target: Move) => [{ id: 'thief', source, target }];

  it('takes a mark off one of yours and puts it on one of theirs', () => {
    const { a, b } = replayMatch(
      [{ a: 'rock', b: 'paper', firedA: steal('lizard', 'robot') }],
      attacker,
      victim,
    );
    // Their lizard enters on 2, loses one to the decrement, loses one to Thief.
    expect(a.lizard).toBe(0);
    expect(b.robot).toBe(1);
  });

  it('does nothing when the move it takes from is already clear', () => {
    const { a, b } = replayMatch(
      [{ a: 'rock', b: 'paper', firedA: steal('scissors', 'robot') }],
      attacker,
      victim,
    );
    expect(a.scissors).toBe(0);
    expect(b.robot).toBe(0);
  });

  it('never drives the move it takes from below zero', () => {
    // Entering round 2 their lizard is on 1, which the decrement alone clears.
    const rounds = [
      { a: 'rock' as const, b: 'paper' as const },
      { a: 'rock' as const, b: 'paper' as const, firedA: steal('lizard', 'robot') },
    ];
    const { a, b } = replayMatch(rounds, attacker, victim);
    expect(a.lizard).toBe(0);
    expect(b.robot).toBe(1);
  });
});

describe('Sacrifice', () => {
  // Sacrifice binds rock, so its owner has marks worth clearing.
  const firer = rulesFor(load('sacrifice'));
  // Two disclosure Trinkets: nothing that prices a move, so the opponent's marks
  // are the round's doing and nothing else's.
  const other = rulesFor(['old-habits', 'watchful']);
  const round = { a: 'rock' as const, b: 'paper' as const, firedA: [{ id: 'sacrifice' }] };
  const at = { roundIndex: 0, lossesA: 0, lossesB: 0 };

  it('makes the round a draw however the moves fell', () => {
    // Paper beats rock, so this is B's round on the moves alone.
    expect(resolveRound(round, firer, other, at)).toEqual({
      seat: 'draw',
      outcomeA: 'draw',
      outcomeB: 'draw',
    });
  });

  it('is declared before picking, so no card reads the result afterwards', () => {
    // Sharp Practice turns a Scissors mirror into a win. A sacrificed round is
    // settled before either seat picks, so there is no result left for it to read.
    const sharp = rulesFor(['sacrifice', 'sharp-practice']);
    const mirror = {
      a: 'scissors' as const,
      b: 'scissors' as const,
      firedA: [{ id: 'sacrifice' }],
    };
    expect(resolveRound(mirror, sharp, other, at).outcomeA).toBe('draw');
  });

  it('clears every one of the firer’s marks', () => {
    const { a } = replayMatch([round], firer, other);
    expect(a).toEqual({ rock: 0, paper: 0, scissors: 0, lizard: 0, robot: 0 });
  });

  it('leaves the opponent’s marks exactly as the round left them', () => {
    const { b } = replayMatch([round], firer, other);
    expect(b.paper).toBe(2);
  });

  it('is a real draw, so the opponent’s draw cards price it as one', () => {
    // Copycat is "on a drawn round, your move takes 1 mark instead of 2". A
    // sacrificed round is drawn, so it does — giving up the round is not a way to
    // deny the opponent what a draw would have paid them.
    const copycat = rulesFor(load('copycat'));
    const { b } = replayMatch([round], firer, copycat);
    expect(b.paper).toBe(1);
  });
});
