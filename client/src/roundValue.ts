import type { Move } from './api';
import { beatsOf } from './moves';

/**
 * What a round is actually worth, before either player picks.
 *
 * Both sides pick simultaneously from the moves they can legally play, so a
 * round is a zero-sum matrix game and it has a value: the score the stronger
 * side can guarantee against any defence, and the weaker side can hold them to.
 * It is the difference between "Ana got lucky" and "Ana was always winning that
 * one", and neither the board nor the result can tell them apart.
 *
 * How many moves a side holds is `availableMoves`' business, not this file's.
 * It used to be three every round — the −1/+2 rule and the opening locks work
 * out that way in a duel, with no exceptions — and this was a hand-derived
 * solution to a 3×3 game that read rows 0–2 and columns 0–2 of whatever it was
 * handed. Helpers ended that: Quarantine, Rust and Freeze drive every move
 * above zero, and then the floor hands back however many are tied for fewest
 * marks — 1, 2, 4 or 5. Fed a five-move board the old solver quietly solved
 * rock/paper/scissors and reported *that* as the round's value, which is worse
 * than throwing, because the commentary then states it as fact (JQ-234).
 *
 * Solved exactly rather than sampled, for any board. `f(p) = min over their
 * moves of the payoff to a mix p` is concave and piecewise linear on the
 * simplex of mixes, so the best mix is a vertex of the linear program
 * `max v subject to p a mix, v ≤ (pA)ⱼ for every j`. Every vertex of that
 * program is fixed by k rows carrying the whole mix and k of their moves the
 * mix ties — so enumerating those pairs, solving each k×k system and keeping
 * the best feasible answer *is* the value, with no iteration, no tolerance and
 * no grid. At five moves a side that is 251 systems, none bigger than 5×5.
 *
 * Pinned to the solver it replaces over every three-move board, which is every
 * board the old one was correct on: see `roundValue.test.ts`.
 */

/** +1 if `a` takes the round, -1 if `b` does, 0 for a mirror. */
function payoff(a: Move, b: Move): number {
  if (a === b) return 0;
  return beatsOf(a).includes(b) ? 1 : -1;
}

/** Below this a pivot is a degenerate system, not a solvable one. */
const EPS = 1e-9;

/** Every k-sized choice from `0..n-1`, as index lists in ascending order. */
function choicesOf(n: number, k: number): number[][] {
  const out: number[][] = [];
  const walk = (start: number, taken: number[]) => {
    if (taken.length === k) {
      out.push(taken);
      return;
    }
    for (let i = start; i <= n - (k - taken.length); i++) walk(i + 1, [...taken, i]);
  };
  walk(0, []);
  return out;
}

/**
 * Gauss-Jordan with partial pivoting, or null when the system is degenerate.
 *
 * Dropping a degenerate system loses nothing. Every vertex of the program has
 * *some* set of independent active constraints of this shape, so a vertex whose
 * system comes out singular under one choice of rows and columns is reached
 * again under another — and a choice that describes no vertex at all had
 * nothing to contribute.
 */
function solveSystem(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const rows = matrix.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(rows[r][col]) > Math.abs(rows[pivot][col])) pivot = r;
    }
    if (Math.abs(rows[pivot][col]) < EPS) return null;
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = rows[r][col] / rows[col][col];
      for (let c = col; c <= n; c++) rows[r][c] -= factor * rows[col][c];
    }
  }
  return rows.map((row, i) => row[n] / row[i]);
}

/**
 * The mix that puts its whole weight on `support` and leaves every move in
 * `ties` paying the same, or null when there is no such mix inside the simplex.
 */
function tieMix(grid: number[][], support: number[], ties: number[]): number[] | null {
  const matrix: number[][] = [];
  const rhs: number[] = [];
  for (let t = 0; t + 1 < ties.length; t++) {
    matrix.push(support.map((i) => grid[i][ties[t]] - grid[i][ties[t + 1]]));
    rhs.push(0);
  }
  matrix.push(support.map(() => 1));
  rhs.push(1);

  const weights = solveSystem(matrix, rhs);
  if (weights === null || weights.some((w) => w < -EPS)) return null;

  const mix = grid.map(() => 0);
  support.forEach((row, s) => {
    mix[row] = weights[s];
  });
  return mix;
}

/** The worst the opponent can hold a mix to — the mix's guaranteed score. */
function guaranteed(mix: number[], grid: number[][]): number {
  let worst = Infinity;
  for (let j = 0; j < grid[0].length; j++) {
    let total = 0;
    for (let i = 0; i < grid.length; i++) total += mix[i] * grid[i][j];
    if (total < worst) worst = total;
  }
  return worst;
}

/**
 * The value of the round to the player holding `mine`, against `theirs`.
 *
 * Positive means they are favoured. Both lists are the moves each side can
 * legally play — `availableMoves`, whatever it returns, rather than a count
 * this file assumes.
 *
 * Null when a side holds nothing. `availableMoves` never returns that, so it is
 * not a board the rules engine can reach and there is no round to put a number
 * on; declining is the honest answer, and it is the caller who has gone wrong.
 */
export function roundValue(mine: Move[], theirs: Move[]): number | null {
  if (mine.length === 0 || theirs.length === 0) return null;

  const grid = mine.map((a) => theirs.map((b) => payoff(a, b)));
  let best = -Infinity;
  for (let k = 1; k <= Math.min(mine.length, theirs.length); k++) {
    for (const support of choicesOf(mine.length, k)) {
      for (const ties of choicesOf(theirs.length, k)) {
        const mix = tieMix(grid, support, ties);
        if (mix === null) continue;
        const score = guaranteed(mix, grid);
        if (score > best) best = score;
      }
    }
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
