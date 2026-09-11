import type { Move } from '../api';

/**
 * Pentagon layout where each move beats the next two clockwise, so the "beats"
 * arrows form the classic RPSLR pentagon + pentagram.
 */
export const CIRCLE_ORDER: Move[] = ['rock', 'scissors', 'lizard', 'paper', 'robot'];

/**
 * The board is drawn in a fixed 380-unit square and then sized by its
 * container: the SVG scales through its viewBox, and the buttons are placed in
 * percentages of the same square. No `transform: scale`, so tap targets grow
 * and shrink with the layout instead of being shrunk after the fact.
 */
export const BOARD = 380;
const NODE_RADIUS = 128;
/** Pull arrow endpoints off the buttons. */
export const ARROW_INSET = 58;
// One vertex sits at the top, so the pentagon's bounding box is taller below
// center than above; nudge the layout center down so it reads centered.
const BOARD_CENTER_Y = BOARD / 2 + 12;

export function circleNodePos(i: number): { x: number; y: number } {
  const angle = (-90 + i * 72) * (Math.PI / 180); // start at top, go clockwise
  return {
    x: BOARD / 2 + NODE_RADIUS * Math.cos(angle),
    y: BOARD_CENTER_Y + NODE_RADIUS * Math.sin(angle),
  };
}

/** All ten "beats" relationships, winner → loser. */
export const CIRCLE_EDGES: Array<{ from: number; to: number }> = (() => {
  const edges: Array<{ from: number; to: number }> = [];
  for (let i = 0; i < CIRCLE_ORDER.length; i++) {
    edges.push({ from: i, to: (i + 1) % CIRCLE_ORDER.length });
    edges.push({ from: i, to: (i + 2) % CIRCLE_ORDER.length });
  }
  return edges;
})();

/** A board coordinate as a percentage of the square, for CSS positioning. */
export function boardPct(v: number): string {
  return `${(v / BOARD) * 100}%`;
}

/**
 * The path an added edge is drawn along.
 *
 * A helper's extra edge is the *reverse* of one the graph already has — Chimera's
 * `lizard → scissors` runs back down the segment `scissors → lizard` occupies — so
 * drawn straight it would land exactly on top of an arrow pointing the other way,
 * and the board would show one line with a head at each end. That is the worst
 * possible reading of a conditional graph: it says the pair beats each other.
 *
 * So it bows. The curve is what makes the edge *visibly* extra rather than
 * silently different: it is the only non-straight line on the board, which is a
 * channel the ten shared edges do not use and colour alone does not have to carry
 * (JQ-151).
 *
 * Two numbers earn their keep here, and both were arrived at by looking at the
 * board rather than by reasoning about it:
 *
 *  - The inset is tighter than `ARROW_INSET`. A reversed edge joins *adjacent*
 *    nodes, whose chord is 150 units; at the shared inset that leaves 34 units of
 *    visible line, and any bow worth seeing on 34 units is a loop rather than an
 *    arc. `ADDED_INSET` buys back the span the curve needs while still clearing
 *    the buttons.
 *  - The bow is a fraction of the *drawn* span, not a fixed offset. Fixed, it is
 *    a loop on a short edge and a barely-there kink on a long one; proportional,
 *    it reads the same on either — which matters because the next added edge need
 *    not join adjacent nodes.
 */
const ADDED_INSET = 48;
const ADDED_BOW = 0.42;

export function addedEdgePath(fromIndex: number, toIndex: number, bow = ADDED_BOW): string {
  const a = circleNodePos(fromIndex);
  const b = circleNodePos(toIndex);
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const start = { x: a.x + ux * ADDED_INSET, y: a.y + uy * ADDED_INSET };
  const end = { x: b.x - ux * ADDED_INSET, y: b.y - uy * ADDED_INSET };
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const span = Math.hypot(end.x - start.x, end.y - start.y) || 1;
  const offset = span * bow;
  // Perpendicular, pointed away from the board's centre — the caption, the Lock in
  // button and the reveal card all live in the middle, and a curve bowing inward
  // would cross them.
  let nx = -uy;
  let ny = ux;
  if ((mid.x - BOARD / 2) * nx + (mid.y - BOARD_CENTER_Y) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  // Doubled: a quadratic curve reaches half way to its control point, so this is
  // what puts the drawn midpoint `offset` units off the straight line.
  const control = { x: mid.x + nx * offset * 2, y: mid.y + ny * offset * 2 };
  return `M ${round(start.x)} ${round(start.y)} Q ${round(control.x)} ${round(control.y)} ${round(
    end.x,
  )} ${round(end.y)}`;
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
