import { useEffect, useState } from 'react';
import type { Move } from '../api';
import { BOARD, CIRCLE_ORDER, circleNodePos } from '../lib/pentagon';
import { prefersReducedMotion } from '../lib/reducedMotion';
import { MOVE_META, beatsOf, describeBeatsOf } from '../moves';
import MoveIcon from './MoveIcon';

/** How long each move holds before the graph steps to the next one. */
const STEP_MS = 2500;
const NODE_R = 36;
/** Half the node's diameter, matching the board's own icon-to-button ratio. */
const ICON_SIZE = 36;
/** Pull arrow ends off the node discs so the heads stay readable. */
const INSET = NODE_R + 8;

/**
 * The board's own pentagon, teaching one move at a time.
 *
 * It reuses the real board geometry so what's learned here transfers directly
 * to the thing they're about to play on — but it draws two arrows, not ten.
 * Ten identical arrowheads at once is the comprehension problem the whole
 * picker redesign exists to fix; five readable beats say the same graph.
 */
export function HowToPlayGraph() {
  const [index, setIndex] = useState(0);
  // Touching a dot means the player is reading at their own pace; stop moving
  // the thing they're reading.
  const [paused, setPaused] = useState(() => prefersReducedMotion());

  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % CIRCLE_ORDER.length), STEP_MS);
    return () => clearInterval(timer);
  }, [paused]);

  const active = CIRCLE_ORDER[index];
  const targets = beatsOf(active);
  const activePos = circleNodePos(index);

  return (
    <div className="htp-graph">
      <svg
        className="htp-graph__svg"
        viewBox={`0 0 ${BOARD} ${BOARD}`}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <defs>
          <marker
            id="htp-arrow"
            className="arrowhead arrowhead--you"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" />
          </marker>
        </defs>

        {targets.map((target) => {
          const to = circleNodePos(CIRCLE_ORDER.indexOf(target));
          const len = Math.hypot(to.x - activePos.x, to.y - activePos.y) || 1;
          const ux = (to.x - activePos.x) / len;
          const uy = (to.y - activePos.y) / len;
          return (
            <line
              key={target}
              className="htp-graph__arrow"
              x1={activePos.x + ux * INSET}
              y1={activePos.y + uy * INSET}
              x2={to.x - ux * INSET}
              y2={to.y - uy * INSET}
              markerEnd="url(#htp-arrow)"
            />
          );
        })}

        {CIRCLE_ORDER.map((move, i) => {
          const pos = circleNodePos(i);
          const role =
            move === active ? 'active' : targets.includes(move) ? 'target' : 'idle';
          return (
            <g key={move} className={`htp-graph__node htp-graph__node--${role}`}>
              <circle cx={pos.x} cy={pos.y} r={NODE_R} />
              <MoveIcon
                move={move}
                size={ICON_SIZE}
                x={pos.x - ICON_SIZE / 2}
                y={pos.y - ICON_SIZE / 2}
              />
            </g>
          );
        })}
      </svg>

      <p className="htp-graph__caption" role="status">
        {describeBeatsOf(active)}
      </p>

      <div className="htp-graph__dots">
        {CIRCLE_ORDER.map((move, i) => (
          <button
            key={move}
            type="button"
            className={`htp-graph__dot${i === index ? ' htp-graph__dot--on' : ''}`}
            aria-label={`Show what ${MOVE_META[move].label} beats`}
            aria-current={i === index}
            onClick={() => {
              setPaused(true);
              setIndex(i);
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** Exported for tests: the move the graph starts on. */
export const FIRST_MOVE: Move = CIRCLE_ORDER[0];
