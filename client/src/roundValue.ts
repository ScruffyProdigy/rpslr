import type { Move } from './api';
import { beatsOf } from './moves';

/**
 * What a round is actually worth, before either player picks.
 *
 * Both sides hold exactly three playable moves and pick simultaneously, so a
 * round is a 3×3 zero-sum game and it has a value: the score the stronger side
 * can guarantee against any defence, and the weaker side can hold them to. It
 * is the difference between "Ana got lucky" and "Ana was always winning that
 * one", and neither the board nor the result can tell them apart.
 *
 * Solved exactly rather than sampled. `f(p) = min over their moves of the
 * payoff to a mix p` is concave and piecewise linear on the triangle of mixes,
 * so its maximum sits on a vertex of the subdivision the ties cut into that
 * triangle. Those vertices are enumerable: the three pure strategies, the
 * points on each edge where two of their moves come out equal, and the one
 * interior point where all three do. Checking every one of them and keeping
 * the best is the answer — no iteration, no tolerance, no grid.
 */

/** +1 if `a` takes the round, -1 if `b` does, 0 for a mirror. */
function payoff(a: Move, b: Move): number {
  if (a === b) return 0;
  return beatsOf(a).includes(b) ? 1 : -1;
}

/** Below this a determinant is a degenerate system, not a solvable one. */
const EPS = 1e-9;

function det3(m: number[][]): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

/** The worst the opponent can hold a mix to — the mix's guaranteed score. */
function guaranteed(mix: number[], grid: number[][]): number {
  let worst = Infinity;
  for (let j = 0; j < 3; j++) {
    let total = 0;
    for (let i = 0; i < 3; i++) total += mix[i] * grid[i][j];
    if (total < worst) worst = total;
  }
  return worst;
}

function isMix(mix: number[]): boolean {
  return mix.every((w) => w >= -EPS);
}

/**
 * The value of the round to the player holding `mine`, against `theirs`.
 *
 * Positive means they are favoured. Both lists are the three moves each side
 * can legally play — which is always three, every round, by the cooldown rule.
 */
export function roundValue(mine: Move[], theirs: Move[]): number {
  const grid = mine.map((a) => theirs.map((b) => payoff(a, b)));
  const candidates: number[][] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];

  // Two moves mixed so that two of their answers come out equal: the vertices
  // sitting on the edges of the triangle.
  for (const [i, k] of [
    [0, 1],
    [0, 2],
    [1, 2],
  ]) {
    for (const [j, l] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
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

  // All three mixed so that all three of their answers come out equal: the one
  // interior vertex.
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
    if (!isMix(mix)) continue;
    const score = guaranteed(mix, grid);
    if (score > best) best = score;
  }
  return best;
}

/** How lopsided a round was, for copy that has to say it in a few words. */
export type RoundEdge = 'even' | 'slight' | 'decisive';

export function roundEdge(value: number): RoundEdge {
  const size = Math.abs(value);
  if (size < EPS) return 'even';
  return size > 0.25 ? 'decisive' : 'slight';
}
