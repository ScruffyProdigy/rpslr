import { describe, expect, it } from 'vitest';
import type { Move } from './api';
import { ALL_MOVES, threatsTo } from './moves';
import { DELAY_ON_CHOICE, INITIAL_DELAYS, type DelayMap } from '@game/game';
import { roundEdge, roundValue } from './roundValue';

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
    expect(roundValue(rps, rps)).toBeCloseTo(0, 10);
  });

  it('is worth a third of a round to hold the safe move and something that beats it', () => {
    // They are resting Paper and Robot, so Rock cannot lose. Their answer is
    // their own Rock for the draw — and Paper, which beats that Rock, is still
    // in hand. Two parts Rock to one part Paper.
    const mine: Move[] = ['rock', 'paper', 'scissors'];
    const theirs: Move[] = ['rock', 'scissors', 'lizard'];
    expect(roundValue(mine, theirs)).toBeCloseTo(1 / 3, 10);
  });

  it('is worth nothing to hold a safe move with no way to punish the mirror', () => {
    // Rock still cannot lose, but Paper and Robot are on *both* sides'
    // cooldowns — so their Rock draws it and there is nothing to be done.
    const both: Move[] = ['rock', 'scissors', 'lizard'];
    expect(roundValue(both, both)).toBeCloseTo(0, 10);
    expect(roundEdge(roundValue(both, both))).toBe('even');
  });

  it('reads the same round in reverse as its exact opposite', () => {
    for (const [a, b] of reachablePositions()) {
      expect(roundValue(live(a), live(b))).toBeCloseTo(-roundValue(live(b), live(a)), 10);
    }
  });

  it('only ever lands on nothing, a twelfth, or a third', () => {
    const seen = new Set<number>();
    for (const [a, b] of reachablePositions()) {
      seen.add(Math.round(roundValue(live(a), live(b)) * 12));
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
      expect(roundValue(live(a), live(b)) > 0.25).toBe(decisive);
    }
  });
});
