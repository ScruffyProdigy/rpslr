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
    // `lossesSoFar: 1` because Grudge sits out the first loss since JQ-209.
    expect(
      marks(['ferrus', 'grudge'], {
        own: 'robot',
        opponent: 'paper',
        outcome: 'loss',
        lossesSoFar: 1,
      }),
    ).toEqual({ own: {}, opponent: { paper: 2 } });
  });
});

describe('Featherweight — Lizard takes 1', () => {
  it('discounts lizard and nothing else', () => {
    expect(cost(load('featherweight'), 'lizard', 'win')).toBe(1);
    expect(cost(load('featherweight'), 'robot', 'win')).toBe(2);
  });
});

describe('Tempered — a losing move costs 1', () => {
  /**
   * It used to charge a winning move 3 to pay for this, and that trade cannot be
   * made: self-harm costs 0.383 a mark where self-relief earns 0.156, so one mark of
   * penalty needs ~2.45 of relief to break even and a losing move can be given back
   * at most 2. The card priced at about -7.6pp — actively bad to hold.
   *
   * The rule that falls out is worth more than the card: in this game anti-snowball
   * has to come from helping the loser, never from taxing the winner.
   */
  it('discounts a loss and leaves every other outcome alone', () => {
    expect(cost(load('tempered'), 'rock', 'loss')).toBe(1);
    expect(cost(load('tempered'), 'rock', 'win')).toBe(2);
    expect(cost(load('tempered'), 'rock', 'draw')).toBe(2);
  });
});

describe('Prologue — the first two moves of the match cost 1', () => {
  it('discounts rounds 0 and 1, and nothing after', () => {
    expect(cost(load('prologue'), 'rock', 'win', 0)).toBe(1);
    expect(cost(load('prologue'), 'rock', 'win', 1)).toBe(1);
    expect(cost(load('prologue'), 'rock', 'win', 2)).toBe(2);
  });

  it('covers Bookend\'s round and one more, so the pair does not double-discount', () => {
    // Both claim round 0 and both say 1, so there is nothing to arbitrate — the
    // second card buys round 1, which is the tier step it is paying for.
    expect(cost(['prologue', 'bookend'], 'rock', 'win', 0)).toBe(1);
    expect(cost(['prologue', 'bookend'], 'rock', 'win', 1)).toBe(1);
    expect(cost(['prologue', 'bookend'], 'rock', 'win', 2)).toBe(2);
  });
});

describe('Copycat — a drawn round costs 1', () => {
  it('discounts a draw only', () => {
    expect(cost(load('copycat'), 'rock', 'draw')).toBe(1);
    expect(cost(load('copycat'), 'rock', 'win')).toBe(2);
    expect(cost(load('copycat'), 'rock', 'loss')).toBe(2);
  });
});

describe('Echo Chamber — a draw costs them an extra mark', () => {
  /**
   * JQ-209 repriced this. It used to charge the holder's drawn move 0 — saving 2
   * marks — on top of a mark on theirs, which came to ~23pp on a 6-7pp tier and made
   * it the roster's worst mispricing. It also swallowed Copycat whole.
   */
  it('no longer touches the cost of your own move', () => {
    expect(cost(load('echo-chamber'), 'rock', 'draw')).toBe(2);
    expect(cost(load('echo-chamber'), 'rock', 'win')).toBe(2);
  });

  it('puts an extra mark on their move alone', () => {
    expect(marks(load('echo-chamber'), { own: 'rock', opponent: 'rock', outcome: 'draw' })).toEqual(
      { own: {}, opponent: { rock: 1 } },
    );
    expect(marks(load('echo-chamber'), { own: 'rock', opponent: 'paper', outcome: 'loss' })).toEqual(
      { own: {}, opponent: {} },
    );
  });

  /**
   * Marking both seats was tried and reverted: it came to exactly zero. A mark you
   * take on costs 0.383, the same as a mark handed out earns — the cheap 0.156 rate
   * is for *shedding* one, which is a different move on the curve.
   */
  it('leaves Copycat its own slot rather than outranking it', () => {
    expect(cost(['echo-chamber', 'copycat'], 'rock', 'draw')).toBe(1);
    expect(
      marks(['echo-chamber', 'copycat'], { own: 'rock', opponent: 'rock', outcome: 'draw' }),
    ).toEqual({ own: {}, opponent: { rock: 1 } });
  });
});

describe('Bookend — your first move of the match costs 1', () => {
  it('discounts round 0 only', () => {
    expect(cost(load('bookend'), 'rock', 'win', 0)).toBe(1);
    expect(cost(load('bookend'), 'rock', 'win', 1)).toBe(2);
  });

  it('is absolute, so a discount beside it changes nothing', () => {
    // There is no surcharge left on this path — Tempered carried the only one, and
    // JQ-209 removed it. Every branch now discounts, so precedence only decides
    // *which* 1 wins rather than whether the cost goes up.
    expect(cost(['bookend', 'tempered'], 'rock', 'win', 0)).toBe(1);
    expect(cost(['bookend', 'tempered'], 'rock', 'win', 1)).toBe(2);
    expect(cost(['bookend', 'tempered'], 'rock', 'loss', 1)).toBe(1);
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

describe('Well Oiled — the Minor that gave Robot a Minor', () => {
  /**
   * The effect Ferrus used to carry, which was cut for being Featherweight at twice
   * the price. As a Minor it is Featherweight's sibling rather than its dominator:
   * same effect, same ~5pp, a different move. Robot opens deepest on the board, so
   * halving its cooldown reads differently there.
   */
  it('halves the cost of playing Robot, and touches nothing else', () => {
    expect(cost(load('well-oiled'), 'robot', 'win')).toBe(1);
    expect(cost(load('well-oiled'), 'robot', 'loss')).toBe(1);
    expect(cost(load('well-oiled'), 'rock', 'win')).toBe(2);
  });

  it('leaves Featherweight its own move', () => {
    expect(cost(load('featherweight'), 'robot', 'win')).toBe(2);
    expect(cost(load('well-oiled'), 'lizard', 'win')).toBe(2);
  });
});

describe('Grudge — from your second loss on, the move that beat you takes an extra mark', () => {
  /**
   * Fired on every loss it was ~13pp — Major strength at a Minor price, the failure
   * the design doc warns makes Minor + Minor the best build. JQ-209 gave the first
   * loss to Small Mercy and the rest to Grudge, which halves it to ~7pp and turns
   * two cards that overlapped into two that partition.
   */
  it('does nothing on the first loss', () => {
    expect(marks(load('grudge'), { own: 'paper', opponent: 'scissors', outcome: 'loss' })).toEqual({
      own: {},
      opponent: {},
    });
  });

  it('marks their move on every loss after that', () => {
    expect(
      marks(load('grudge'), { own: 'paper', opponent: 'scissors', outcome: 'loss', lossesSoFar: 1 }),
    ).toEqual({ own: {}, opponent: { scissors: 1 } });
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

describe('Grudge and Small Mercy divide the losses between them', () => {
  /**
   * They used to stack two marks on the first loss and one thereafter. JQ-209 gave
   * Small Mercy the first loss and Grudge the rest, so the pair now marks exactly
   * one move per loss — a steady mark rather than a spike, and neither card is the
   * other's superset any more.
   */
  it('marks once on the first loss, from Small Mercy alone', () => {
    expect(
      marks(['grudge', 'small-mercy'], { own: 'paper', opponent: 'scissors', outcome: 'loss' }),
    ).toEqual({ own: {}, opponent: { scissors: 1 } });
  });

  it('marks once on later losses, from Grudge alone', () => {
    expect(
      marks(['grudge', 'small-mercy'], {
        own: 'paper',
        opponent: 'scissors',
        outcome: 'loss',
        lossesSoFar: 1,
      }),
    ).toEqual({ own: {}, opponent: { scissors: 1 } });
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
  // The doc's own "pairing to check first" was Good Old Rock + Second Wind — both
  // Rock-bound, both turning a loss into a draw. It is gone rather than fixed:
  // JQ-236 retired Second Wind to make room for Tripwire, and cutting it retires
  // the concern with it. No card now converts a loss to a draw except Good Old
  // Rock, so there is no second save to stack, and nothing to test here.
  //
  // The remaining pair worth watching is Quarantine + Tripwire, which has its own
  // block above — that one is a real interaction rather than a redundancy.

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
    expect(missed).toEqual({ quarantine: { marks: 4, available: false } });
  });
});

describe('Flywheel — every move on cooldown loses a mark', () => {
  const firer = rulesFor(load('flywheel'));
  const fire = () =>
    firer.fireEffects({
      firings: [{ id: 'flywheel' }],
      own: 'rock',
      opponent: 'rock',
      ownDelays: { rock: 0, paper: 2, scissors: 1, lizard: 0, robot: 3 },
      opponentDelays: { rock: 0, paper: 0, scissors: 0, lizard: 0, robot: 0 },
    });

  it('takes one off each blocked move and skips the clear ones', () => {
    expect(fire().marks).toEqual({ own: { paper: -1, scissors: -1, robot: -1 }, opponent: {} });
  });

  it('reaches across to nothing of theirs — it is relief, not denial', () => {
    expect(fire().marks.opponent).toEqual({});
    expect(fire().freezesOpponentDecay).toBe(false);
  });
});

describe('Feint — this round\'s marks land on a move you name', () => {
  const firer = rulesFor(load('feint'));
  const fire = (target: Move, own: Move = 'rock') =>
    firer.fireEffects({
      firings: [{ id: 'feint', target }],
      own,
      opponent: 'paper',
      ownDelays: { rock: 0, paper: 0, scissors: 0, lizard: 0, robot: 0 },
      opponentDelays: { rock: 0, paper: 0, scissors: 0, lizard: 0, robot: 0 },
    });

  /**
   * The only card that moves marks rather than counting them, and so the only way to
   * play the same move twice running — the design doc treats that as a fact about
   * the game rather than a rule, and nothing else on the roster leans on it.
   */
  it('credits the played move back and charges the named one instead', () => {
    expect(fire('robot').marks).toEqual({ own: { rock: -2, robot: 2 }, opponent: {} });
  });

  it('does nothing when it names the move being played', () => {
    // Otherwise it would cancel its own credit and read as a free round.
    expect(fire('rock').marks).toEqual({ own: {}, opponent: {} });
  });

  it('never touches their board', () => {
    expect(fire('robot').marks.opponent).toEqual({});
  });
});

/**
 * JQ-236's secret half of the name-a-move pair. The marks are deliberately
 * identical to Quarantine's — `reveal` decides who is told, never what a firing
 * does — so what these assert is that the two really are the same effect, and that
 * the difference between the cards lives entirely in disclosure and cadence.
 */
describe('Tripwire', () => {
  const attacker = rulesFor(load('tripwire'));
  const victim = rulesFor(load('copycat'));
  const name = (target: Move) => [{ id: 'tripwire', target }];

  it('adds 2 marks to the named move when they play it, exactly as Quarantine does', () => {
    const { b } = replayMatch(
      [{ a: 'rock', b: 'lizard', firedA: name('lizard') }],
      attacker,
      victim,
    );
    // Their lizard takes its own 2 choice marks, and Tripwire's 2 on top.
    expect(b.lizard).toBe(4);
  });

  it('does nothing at all when they play something else', () => {
    const { b } = replayMatch(
      [{ a: 'rock', b: 'lizard', firedA: name('scissors') }],
      attacker,
      victim,
    );
    expect(b.scissors).toBe(0);
    expect(b.lizard).toBe(2);
  });

  it('spends the charge on a miss just as on a hit', () => {
    const missed = abilityMarks(['tripwire', 'old-habits'], [name('scissors')]);
    expect(missed).toEqual({ tripwire: { marks: 3, available: false } });
  });
});

/**
 * The pair, drafted together. Legal since JQ-238 gave each ability its own slot,
 * and worth a test because the two compose: Quarantine is announced, so a competent
 * opponent steps off the move it names and picks from two rather than three — which
 * is what lifts Tripwire's secret guess from a 1/3 hit to a 1/2.
 */
describe('Quarantine beside Tripwire', () => {
  const attacker = rulesFor(['quarantine', 'tripwire']);
  const victim = rulesFor(load('copycat'));
  const both = (q: Move, t: Move) => [
    { id: 'quarantine', target: q },
    { id: 'tripwire', target: t },
  ];

  it('lands the secret name when they step off the announced one', () => {
    const { b } = replayMatch(
      [{ a: 'rock', b: 'lizard', firedA: both('scissors', 'lizard') }],
      attacker,
      victim,
    );
    // Quarantine named scissors aloud and they avoided it; the move they stepped
    // onto was the one Tripwire had quietly named. 2 choice marks plus 2.
    expect(b.lizard).toBe(4);
    expect(b.scissors).toBe(0);
  });

  it('lands both weights on one move when both name it', () => {
    const { b } = replayMatch(
      [{ a: 'rock', b: 'lizard', firedA: both('lizard', 'lizard') }],
      attacker,
      victim,
    );
    // Allowed rather than rejected, per JQ-238, and strictly worse for the firer:
    // the announced name is the one they dodge, so a Tripwire pointed at the same
    // move is spent on a square they have already been warned off. It must still
    // add up — 2 choice marks plus 2 plus 2.
    expect(b.lizard).toBe(6);
  });
});

describe('Rust', () => {
  const attacker = rulesFor(load('rust'));
  // Ferrus binds robot, so B enters the match with one live move and four clear.
  const victim = rulesFor(['ferrus', 'copycat']);
  const at = (target: Move) => [{ id: 'rust', target }];

  it('adds a mark to a move already on their cooldown', () => {
    const { b } = replayMatch([{ a: 'rock', b: 'paper', firedA: at('robot') }], attacker, victim);
    // robot enters on 2, loses one to the decrement, takes Rust's 1.
    expect(b.robot).toBe(2);
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
    expect(b.robot).toBe(1);
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

/**
 * JQ-238: two charged abilities, both fired in one round.
 *
 * Nothing here is new engine behaviour — `PlayedRound.firedA` has always been an
 * array and `fireEffects` has always looked each ability up independently. The
 * rule that forbade it lived in the service and in a unique index, and this suite
 * is the evidence that removing it needed no engine change: `rules.ts` and
 * `game.ts` are untouched by that ticket.
 */
describe('two abilities fired by one seat in one round', () => {
  // Rust binds scissors and Thief binds lizard, so the firer opens with 2 marks on
  // each — the mark Thief needs to move, and no collision roll to store.
  const firer = rulesFor(['rust', 'thief']);
  // Quarantine binds scissors, so the victim has the cooldown Rust needs to deepen.
  const victim = rulesFor(['quarantine', 'poker-face']);

  it('composes both mark adjustments rather than honouring whichever came first', () => {
    const { a, b } = replayMatch(
      [
        {
          a: 'rock',
          b: 'rock',
          firedA: [
            { id: 'rust', target: 'scissors' },
            { id: 'thief', source: 'lizard', target: 'scissors' },
          ],
        },
      ],
      firer,
      victim,
    );
    // Their scissors: 2 entering, 1 after the decrement, +1 from Rust and +1 from
    // Thief. Either firing alone would leave 2; both leave 3.
    expect(b.scissors).toBe(3);
    // And Thief's own half still lands: the firer's lizard goes 2 → 1 → 0.
    expect(a.lizard).toBe(0);
  });

  it('reads Thief\u2019s source from the marks entering the round, not from what Rust did', () => {
    // Both firings read `ownDelays`/`opponentDelays` as they stood entering the
    // round, so Rust deepening a cooldown cannot retroactively make Thief's source
    // legal, and Thief lifting a mark cannot make Rust's target clear.
    const effect = firer.fireEffects({
      firings: [
        { id: 'rust', target: 'scissors' },
        { id: 'thief', source: 'lizard', target: 'scissors' },
      ],
      own: 'rock',
      opponent: 'rock',
      ownDelays: { rock: 0, paper: 0, scissors: 2, lizard: 2, robot: 0 },
      opponentDelays: { rock: 0, paper: 0, scissors: 2, lizard: 0, robot: 0 },
    });
    expect(effect.marks).toEqual({ own: { lizard: -1 }, opponent: { scissors: 2 } });
  });

  it('floors the combined adjustment at zero when the source decremented away', () => {
    // Entering round 2 the firer's lizard is on 1, which the decrement alone
    // clears. Thief's -1 lands on a move already at zero and must not go negative.
    const { a, b } = replayMatch(
      [
        { a: 'rock', b: 'rock' },
        {
          a: 'paper',
          b: 'rock',
          firedA: [
            { id: 'rust', target: 'scissors' },
            { id: 'thief', source: 'lizard', target: 'scissors' },
          ],
        },
      ],
      firer,
      victim,
    );
    expect(a.lizard).toBe(0);
    // Thief still lands its half on the opponent: it moved a mark that existed
    // when the firing was validated, so the round pays out even though the floor
    // swallowed the subtraction.
    expect(b.scissors).toBe(2);
  });

  it('lets one of the two settle the round while the other still adjusts marks', () => {
    // Sacrifice makes the round a draw; Freeze stops the opponent's decrement. Two
    // abilities on different hooks, fired together, both taken.
    const both = rulesFor(['sacrifice', 'freeze']);
    const firings = [{ id: 'sacrifice' }, { id: 'freeze' }];
    expect(both.declaresDraw(firings)).toBe(true);
    expect(
      both.fireEffects({
        firings,
        own: 'rock',
        opponent: 'rock',
        ownDelays: { rock: 0, paper: 0, scissors: 0, lizard: 0, robot: 0 },
        opponentDelays: { rock: 0, paper: 0, scissors: 0, lizard: 0, robot: 0 },
      }).freezesOpponentDecay,
    ).toBe(true);
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

  it('clears the firer’s marks, and then the move they played takes its cost', () => {
    const { a } = replayMatch([round], firer, other);
    // The clear lands when the ability is fired — before the pick — so the reset is
    // total but the round still costs a move. Four live, not five: Sacrifice buys
    // the board back for a move's tempo rather than for nothing, which is what
    // keeps it a don't-lose button rather than a win button.
    expect(a).toEqual({ rock: 2, paper: 0, scissors: 0, lizard: 0, robot: 0 });
  });

  it('leaves the opponent’s marks exactly as the round left them', () => {
    const { b } = replayMatch([round], firer, other);
    expect(b.paper).toBe(2);
  });

  it('is a real draw, so the opponent’s draw cards still reach across it', () => {
    // Echo Chamber is "on a drawn round, their move takes an extra mark and yours
    // doesn't". The clear lands at fire time, so a mark the round goes on to add
    // survives it: the firer does not get to wipe what the round costs them.
    const echo = rulesFor(['echo-chamber', 'watchful']);
    const { a } = replayMatch([round], firer, echo);
    expect(a).toEqual({ rock: 3, paper: 0, scissors: 0, lizard: 0, robot: 0 });
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
