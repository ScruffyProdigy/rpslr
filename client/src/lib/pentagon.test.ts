import { describe, expect, it } from 'vitest';
import { ARROW_INSET, BOARD, CIRCLE_EDGES, CIRCLE_ORDER, addedEdgePath, circleNodePos } from './pentagon';

/**
 * The geometry an added edge is drawn on (JQ-151).
 *
 * Chimera's `lizard → scissors` is the reverse of a shared edge, so the one thing
 * that must not happen is a straight line: it would land on top of `scissors →
 * lizard` and the board would read as "these two beat each other".
 */
function points(d: string): { start: [number, number]; control: [number, number]; end: [number, number] } {
  const n = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  return { start: [n[0], n[1]], control: [n[2], n[3]], end: [n[4], n[5]] };
}

/** Where the drawn curve actually sits at its midpoint (t = 0.5 on a quadratic). */
function midpointOf(d: string): [number, number] {
  const { start, control, end } = points(d);
  return [
    0.25 * start[0] + 0.5 * control[0] + 0.25 * end[0],
    0.25 * start[1] + 0.5 * control[1] + 0.25 * end[1],
  ];
}

const LIZARD = CIRCLE_ORDER.indexOf('lizard');
const SCISSORS = CIRCLE_ORDER.indexOf('scissors');

describe('addedEdgePath', () => {
  it('is a quadratic curve, not a line', () => {
    expect(addedEdgePath(LIZARD, SCISSORS)).toMatch(/^M [\d.-]+ [\d.-]+ Q [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+$/);
  });

  // Tighter than the shared inset, but still short of the node itself: a reversed
  // edge joins adjacent nodes, and at ARROW_INSET there is not enough line left to
  // draw an arc on.
  it('is inset off both nodes, further in than a shared arrow reaches', () => {
    const a = circleNodePos(LIZARD);
    const b = circleNodePos(SCISSORS);
    const { start, end } = points(addedEdgePath(LIZARD, SCISSORS));
    const fromNode = Math.hypot(start[0] - a.x, start[1] - a.y);
    expect(fromNode).toBeGreaterThan(40);
    expect(fromNode).toBeLessThan(ARROW_INSET);
    expect(Math.hypot(end[0] - b.x, end[1] - b.y)).toBeCloseTo(fromNode, 1);
  });

  // Proportional, not fixed: fixed is a loop on a short edge and a kink on a long
  // one, and the next added edge need not join adjacent nodes.
  it('bows by a fraction of the span it is drawn over', () => {
    for (const [from, to] of [[LIZARD, SCISSORS], [0, 2]] as const) {
      const d = addedEdgePath(from, to);
      const { start, end } = points(d);
      const mid = midpointOf(d);
      const straight = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
      const span = Math.hypot(end[0] - start[0], end[1] - start[1]);
      expect(Math.hypot(mid[0] - straight[0], mid[1] - straight[1])).toBeCloseTo(span * 0.42, 1);
    }
  });

  // The failure the first draft shipped: a bow as big as the span reads as a loop.
  it('never bows further than the line it is drawn over is long', () => {
    for (const { from, to } of CIRCLE_EDGES) {
      const d = addedEdgePath(to, from);
      const { start, end } = points(d);
      const mid = midpointOf(d);
      const straight = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
      const span = Math.hypot(end[0] - start[0], end[1] - start[1]);
      expect(Math.hypot(mid[0] - straight[0], mid[1] - straight[1])).toBeLessThan(span * 0.5);
    }
  });

  // The caption, the Lock in button and the reveal card all live in the middle of
  // the board. A curve bowing inward would cross them.
  it('bows away from the centre, where the caption sits', () => {
    const centre = [BOARD / 2, BOARD / 2 + 12];
    for (const { from, to } of CIRCLE_EDGES) {
      const d = addedEdgePath(to, from); // every reversed edge is a candidate
      const { start, end } = points(d);
      const mid = midpointOf(d);
      const straight = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
      const before = Math.hypot(straight[0] - centre[0], straight[1] - centre[1]);
      const after = Math.hypot(mid[0] - centre[0], mid[1] - centre[1]);
      expect(after).toBeGreaterThan(before);
    }
  });

  it('stays inside the board box, so nothing is clipped by the viewBox', () => {
    for (const { from, to } of CIRCLE_EDGES) {
      const d = addedEdgePath(to, from);
      const { start, end } = points(d);
      // The apex is the only point that can escape — the endpoints sit on the
      // pentagon — but both are checked rather than argued about.
      for (const [x, y] of [midpointOf(d), start, end]) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(BOARD);
        expect(y).toBeLessThanOrEqual(BOARD);
      }
    }
  });
});
