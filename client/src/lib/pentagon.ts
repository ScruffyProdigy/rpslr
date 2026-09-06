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
