import { describe, expect, it } from 'vitest';
import type { Move } from './api';
import { ALL_MOVES, beatsOf, threatsTo } from './moves';
import { DELAY_ON_CHOICE, INITIAL_DELAYS, type DelayMap } from '@game/game';
import { roundEdge, roundValue } from './roundValue';

/**
 * The value of a position the duel search reached.
 *
 * `roundValue` declines a board with an empty side, which is why it returns
 * `number | null` — but `availableMoves` never returns nothing, so no position
 * this search walks can produce one. Unwrapping here says that once instead of
 * threading a null through every assertion below.
 */
function valueOf(mine: Move[], theirs: Move[]): number {
  const value = roundValue(mine, theirs);
  if (value === null) throw new Error(`both sides hold moves: ${mine} vs ${theirs}`);
  return value;
}

/**
 * A duel's cooldown step: every move −1, then the pick +2.
 *
 * Spelled out here rather than imported because this search is about `duel` and
 * nothing else — it enumerates the positions that mode can reach so `roundValue`
 * can be checked against all of them. A helpers match reaches different ones, and
 * would be a different search. The two numbers still come from the engine, so the
 * duel it walks stays the duel the server plays.
 */
function advanceDelays(delays: DelayMap, chosen: Move): DelayMap {
  const next = { ...delays };
  for (const move of ALL_MOVES) next[move] = Math.max(0, next[move] - 1);
  next[chosen] += DELAY_ON_CHOICE;
  return next;
}

/** Every cooldown position the game can actually reach, to a useful depth. */
function reachablePositions(depth = 6): [DelayMap, DelayMap][] {
  const found = new Map<string, [DelayMap, DelayMap]>();
  const key = (a: DelayMap, b: DelayMap) =>
    ALL_MOVES.map((m) => a[m]).join('') + '|' + ALL_MOVES.map((m) => b[m]).join('');
  const walk = (a: DelayMap, b: DelayMap, left: number) => {
    if (!found.has(key(a, b))) found.set(key(a, b), [a, b]);
    if (left === 0) return;
    for (const x of live(a)) for (const y of live(b)) walk(advanceDelays(a, x), advanceDelays(b, y), left - 1);
  };
  walk({ ...INITIAL_DELAYS }, { ...INITIAL_DELAYS }, depth);
  return [...found.values()];
}

const live = (d: DelayMap): Move[] => ALL_MOVES.filter((m) => d[m] === 0);

/** The move nothing they can play beats, if there is one. There is never more than one. */
const safeMoveAgainst = (theirDelays: DelayMap): Move | undefined =>
  ALL_MOVES.find((m) => threatsTo(m, theirDelays).safe);

describe('roundValue', () => {
  it('calls the opening round even — it is plain Rock Paper Scissors', () => {
    const rps: Move[] = ['rock', 'paper', 'scissors'];
    expect(valueOf(rps, rps)).toBeCloseTo(0, 10);
  });

  it('is worth a third of a round to hold the safe move and something that beats it', () => {
    // They are resting Paper and Robot, so Rock cannot lose. Their answer is
    // their own Rock for the draw — and Paper, which beats that Rock, is still
    // in hand. Two parts Rock to one part Paper.
    const mine: Move[] = ['rock', 'paper', 'scissors'];
    const theirs: Move[] = ['rock', 'scissors', 'lizard'];
    expect(valueOf(mine, theirs)).toBeCloseTo(1 / 3, 10);
  });

  it('is worth nothing to hold a safe move with no way to punish the mirror', () => {
    // Rock still cannot lose, but Paper and Robot are on *both* sides'
    // cooldowns — so their Rock draws it and there is nothing to be done.
    const both: Move[] = ['rock', 'scissors', 'lizard'];
    expect(valueOf(both, both)).toBeCloseTo(0, 10);
    expect(roundEdge(valueOf(both, both))).toBe('even');
  });

  it('reads the same round in reverse as its exact opposite', () => {
    for (const [a, b] of reachablePositions()) {
      expect(valueOf(live(a), live(b))).toBeCloseTo(-valueOf(live(b), live(a)), 10);
    }
  });

  it('only ever lands on nothing, a twelfth, or a third', () => {
    const seen = new Set<number>();
    for (const [a, b] of reachablePositions()) {
      seen.add(Math.round(valueOf(live(a), live(b)) * 12));
    }
    expect([...seen].sort((x, y) => x - y)).toEqual([-4, -1, 0, 1, 4]);
  });

  it('is decisive exactly when one side holds the safe move and something that beats it', () => {
    // The whole strategy layer rests on this: the structural read the
    // commentary can explain and the number the solver produces are the same
    // fact, in every position the game can reach.
    for (const [a, b] of reachablePositions()) {
      const safe = safeMoveAgainst(b);
      const decisive =
        safe !== undefined &&
        live(a).includes(safe) &&
        threatsTo(safe, b).all.some((m) => live(a).includes(m));
      expect(valueOf(live(a), live(b)) > 0.25).toBe(decisive);
    }
  });
});

/**
 * `roundValue` as it stood before JQ-234: a hand-derived exact solution to a
 * 3×3 game by vertex enumeration on the 2-simplex, copied verbatim.
 *
 * Frozen here rather than imported, and deliberately not deleted with the
 * original. This is game-theory code with no cheap oracle — a wrong value looks
 * exactly like a right one — so the only honest way to generalise it was to pin
 * the generalisation to the behaviour that was already trusted, over every
 * board the old solver was ever correct on. It answers for 3×3 and nothing
 * else; the four probes in the ticket are the shapes where it threw or, worse,
 * quietly solved a sub-game and reported that as the round.
 */
function legacyRoundValue(mine: Move[], theirs: Move[]): number {
  const EPS = 1e-9;
  const payoff = (a: Move, b: Move) => (a === b ? 0 : beatsOf(a).includes(b) ? 1 : -1);
  const det3 = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const grid = mine.map((a) => theirs.map((b) => payoff(a, b)));
  const candidates: number[][] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const pairs = [
    [0, 1],
    [0, 2],
    [1, 2],
  ];
  for (const [i, k] of pairs) {
    for (const [j, l] of pairs) {
      const spread = grid[i][j] - grid[i][l] - (grid[k][j] - grid[k][l]);
      if (Math.abs(spread) < EPS) continue;
      const weight = (grid[k][l] - grid[k][j]) / spread;
      if (weight < -EPS || weight > 1 + EPS) continue;
      const mix = [0, 0, 0];
      mix[i] = weight;
      mix[k] = 1 - weight;
      candidates.push(mix);
    }
  }
  const rows = [0, 1, 2];
  const system = [
    rows.map((i) => grid[i][0] - grid[i][1]),
    rows.map((i) => grid[i][1] - grid[i][2]),
    [1, 1, 1],
  ];
  const base = det3(system);
  if (Math.abs(base) > EPS) {
    const mix = rows.map((col) =>
      det3(system.map((row, r) => row.map((cell, c) => (c === col ? [0, 0, 1][r] : cell)))),
    );
    candidates.push(mix.map((w) => w / base));
  }
  let best = -Infinity;
  for (const mix of candidates) {
    if (!mix.every((w) => w >= -EPS)) continue;
    let worst = Infinity;
    for (let j = 0; j < 3; j++) {
      let total = 0;
      for (let i = 0; i < 3; i++) total += mix[i] * grid[i][j];
      if (total < worst) worst = total;
    }
    if (worst > best) best = worst;
  }
  return best;
}

/** Every three-move hand, which is every hand the old solver could answer for. */
function threeMoveHands(): Move[][] {
  const hands: Move[][] = [];
  for (let i = 0; i < ALL_MOVES.length; i++)
    for (let j = i + 1; j < ALL_MOVES.length; j++)
      for (let k = j + 1; k < ALL_MOVES.length; k++)
        hands.push([ALL_MOVES[i], ALL_MOVES[j], ALL_MOVES[k]]);
  return hands;
}

describe('roundValue generalised (JQ-234)', () => {
  it('agrees with the 3×3 solver it replaces on every three-move board', () => {
    const hands = threeMoveHands();
    expect(hands).toHaveLength(10);
    for (const mine of hands) {
      for (const theirs of hands) {
        expect(valueOf(mine, theirs)).toBeCloseTo(legacyRoundValue(mine, theirs), 10);
      }
    }
  });

  it('declines a board with a side holding nothing rather than throwing', () => {
    // Probes 1 and 3 from the ticket. `availableMoves` cannot produce either —
    // its floor always returns the least-marked moves — so this is the shape
    // that has no value rather than a value worth reporting, and saying so is
    // the whole reason the return type is nullable.
    const rps: Move[] = ['rock', 'paper', 'scissors'];
    expect(roundValue([], rps)).toBeNull();
    expect(roundValue(rps, [])).toBeNull();
  });

  it('solves a two-move hand against a three-move one', () => {
    // Probe 2, and the likely one: a tie between two least-marked moves is the
    // ordinary shape of a floor round. Rock draws their Rock and beats their
    // Scissors; Paper covers their Rock and loses to their Scissors. Two parts
    // Rock to one part Paper holds both their answers to a third.
    expect(valueOf(['rock', 'paper'], ['rock', 'scissors'])).toBeCloseTo(1 / 3, 10);
  });

  it('reads the whole board rather than the rock/paper/scissors corner of it', () => {
    // Probe 4's real failure. Against plain Rock/Paper/Scissors, a hand holding
    // all five is favoured: Robot beats two of their three and loses only to
    // Paper. The answer is two ninths Paper, four ninths Scissors, three ninths
    // Robot, which their best defence — a third Rock, four ninths Paper, two
    // ninths Scissors — holds to exactly a ninth. The old solver read rows 0–2
    // and columns 0–2, solved rock/paper/scissors, and called the round even.
    expect(valueOf(ALL_MOVES, ['rock', 'paper', 'scissors'])).toBeCloseTo(1 / 9, 10);
    expect(legacyRoundValue(ALL_MOVES, ['rock', 'paper', 'scissors'])).toBeCloseTo(0, 10);
  });

  it('calls a board both sides hold in full even, and for the right reason', () => {
    // Probe 4 as stated. The old solver also returned 0 here, but only because
    // the sub-game it happened to solve was itself fair.
    expect(valueOf(ALL_MOVES, ALL_MOVES)).toBeCloseTo(0, 10);
  });

  it('values a forced round at the payoff of the pick nobody chose', () => {
    // One move each: no strategy, so the value is just the outcome. Whether
    // that is worth *saying* is the commentary's call, not the solver's.
    expect(valueOf(['rock'], ['scissors'])).toBeCloseTo(1, 10);
    expect(valueOf(['rock'], ['paper'])).toBeCloseTo(-1, 10);
    expect(valueOf(['rock'], ['rock'])).toBeCloseTo(0, 10);
  });

  it('reads a pinned side as beaten by anyone who can answer it', () => {
    // A hand of one is public — playability is on the board — so the free side
    // simply plays the counter.
    expect(valueOf(['rock'], ['rock', 'paper', 'scissors'])).toBeCloseTo(-1, 10);
    expect(valueOf(['rock', 'paper', 'scissors'], ['rock'])).toBeCloseTo(1, 10);
  });

  it('stays exactly anti-symmetric on every board either side can hold', () => {
    // The one property that holds for every shape, and the cheapest check that
    // the generalisation did not pick up an orientation bug along the way.
    for (const mine of everyHand()) {
      for (const theirs of everyHand()) {
        expect(valueOf(mine, theirs)).toBeCloseTo(-valueOf(theirs, mine), 10);
      }
    }
  });

  it('never values a board outside what a single round can pay', () => {
    for (const mine of everyHand()) {
      for (const theirs of everyHand()) {
        const value = valueOf(mine, theirs);
        expect(value).toBeGreaterThanOrEqual(-1);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('calls a board a side holds in full at least as good as any smaller one', () => {
    // Holding more moves can never hurt: every mix over a sub-hand is still
    // available. A generalisation that silently truncated would fail this.
    for (const theirs of everyHand()) {
      const whole = valueOf(ALL_MOVES, theirs);
      for (const mine of everyHand()) {
        expect(whole).toBeGreaterThanOrEqual(valueOf(mine, theirs) - 1e-9);
      }
    }
  });
});

/** Every non-empty hand the floor can hand back — all 31 of them. */
function everyHand(): Move[][] {
  const hands: Move[][] = [];
  for (let mask = 1; mask < 1 << ALL_MOVES.length; mask++) {
    hands.push(ALL_MOVES.filter((_, i) => mask & (1 << i)));
  }
  return hands;
}
