import { useId } from 'react';
import type { ReactElement } from 'react';
import type { Move } from '../api';

/**
 * The five moves as one drawn set, replacing the emoji.
 *
 * Why not emoji: 🪨 and 🤖 and 📄 are all grey-white blobs on most platforms,
 * they redraw differently on every OS, and they cannot be tinted — so the
 * reveal card could never say "this one was yours" in your colour.
 *
 * The set is one style throughout: a solid silhouette in `currentColor` with
 * its interior detail cut *out* rather than painted over. The cut is a real
 * hole (a luminance mask), so an icon sits on the button, the reveal card, a
 * history chip or the graph without anyone having to tell it what colour the
 * surface behind it is.
 *
 * Sized in `em`, so the call site sets `font-size` and the icon follows —
 * which is how the emoji behaved, and keeps the container queries that size
 * the board working unchanged.
 */

interface MoveIconProps {
  move: Move;
  className?: string;
  /**
   * Side in user units, for drawing the icon *inside* another `<svg>` (the
   * teaching graph does this). With it, `x`/`y` place the icon's top-left in
   * the parent's coordinate space. Without it the icon is 1em and flows with
   * the text around it.
   */
  size?: number;
  x?: number;
  y?: number;
}

/** Silhouette (drawn white) and cut-outs (drawn black) for each move. */
const ART: Record<Move, ReactElement> = {
  /* Angular and asymmetric, with two short unconnected chips. Edge lengths
     vary on purpose: a near-regular polygon reads as a pebble, and any
     *connected* interior seam network reads as an isometric cube. */
  rock: (
    <>
      <path
        d="M3.2 13.9 L6.5 7.1 L12.9 4.5 L17.1 6.1 L20.8 11.5 L18.8 17.5 L12.9 20.3 L6.5 18.5 Z"
        fill="#fff"
        stroke="#fff"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <g fill="none" stroke="#000" strokeWidth="1.35" strokeLinecap="round">
        <path d="M8.0 10.6 L11.0 12.6" />
        <path d="M9.6 15.9 L13.4 16.4" />
      </g>
    </>
  ),
  /* A sheet with a turned corner, ruled. */
  paper: (
    <>
      <path d="M5.5 2.8 H14.6 L19.4 7.6 V21.2 H5.5 Z" fill="#fff" />
      <path
        d="M14.6 2.8 V7.6 H19.4"
        fill="none"
        stroke="#000"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M8.4 11.6 H16.4 M8.4 14.6 H16.4 M8.4 17.6 H13.2"
        stroke="#000"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </>
  ),
  /* Two loops, two blades, a pivot. */
  scissors: (
    <>
      <g fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round">
        <path d="M7.4 3.4 L15.2 16.4" />
        <path d="M16.6 3.4 L8.8 16.4" />
        <circle cx="6.6" cy="19.1" r="2.6" />
        <circle cx="17.4" cy="19.1" r="2.6" />
      </g>
      <circle cx="12" cy="12.6" r="1.5" fill="#fff" />
    </>
  ),
  /* Top-down gecko: bilateral, elongated, tail longer than the body. The
     weight sits in the body and tail rather than the legs — four equal
     splayed legs around a round body is a spider, not a lizard. */
  lizard: (
    <>
      <g fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round">
        <path
          d="M12 13.4 C12 16.6 13.6 18.6 15.9 19.2 C18.2 19.8 19.6 18.4 19.1 16.8 C18.7 15.5 17.1 15.4 16.8 16.6"
          strokeWidth="2.1"
        />
        <path d="M10.1 8.0 L7.6 6.5 L6.4 7.4" strokeWidth="1.45" />
        <path d="M13.9 8.0 L16.4 6.5 L17.6 7.4" strokeWidth="1.45" />
        <path d="M10.4 12.1 L8.0 13.6 L7.0 12.6" strokeWidth="1.45" />
        <path d="M13.6 12.1 L16.0 13.6 L17.0 12.6" strokeWidth="1.45" />
      </g>
      <path
        d="M12 2.6 C13.7 2.6 14.7 3.9 14.7 5.4 C14.7 6.6 14.3 7.2 14.3 8.2 C14.3 9.6 14.9 10.6 14.9 12.1 C14.9 13.6 13.7 14.7 12 14.7 C10.3 14.7 9.1 13.6 9.1 12.1 C9.1 10.6 9.7 9.6 9.7 8.2 C9.7 7.2 9.3 6.6 9.3 5.4 C9.3 3.9 10.3 2.6 12 2.6 Z"
        fill="#fff"
      />
      <circle cx="10.8" cy="4.8" r="0.62" fill="#000" />
      <circle cx="13.2" cy="4.8" r="0.62" fill="#000" />
    </>
  ),
  /* A head: antenna, visor, two eyes. */
  robot: (
    <>
      <path
        d="M6 8.4 h12 a2.4 2.4 0 0 1 2.4 2.4 v7.2 a2.4 2.4 0 0 1 -2.4 2.4 h-12 a2.4 2.4 0 0 1 -2.4 -2.4 v-7.2 a2.4 2.4 0 0 1 2.4 -2.4 z"
        fill="#fff"
      />
      <path d="M12 8.4 V5.2" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" />
      <circle cx="12" cy="3.6" r="1.7" fill="#fff" />
      <g fill="#000">
        <circle cx="9" cy="13.4" r="1.55" />
        <circle cx="15" cy="13.4" r="1.55" />
      </g>
      <path d="M9.2 17.4 H14.8" stroke="#000" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
};

export default function MoveIcon({ move, className, size, x, y }: MoveIconProps) {
  /* Mask ids must be unique per instance — the same move is on screen several
     times at once (button, graph, history), and a duplicate id would make
     every copy use the first one's mask. */
  const maskId = useId();
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size ?? '1em'}
      height={size ?? '1em'}
      x={x}
      y={y}
      data-move={move}
      /* Decorative everywhere it is used: every call site already carries the
         move's name in adjacent text, and announcing it twice is worse than
         not announcing it. */
      aria-hidden="true"
      focusable="false"
    >
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        {/* Black ground, white silhouette, black detail: the detail becomes a
            hole, so whatever surface is behind the icon shows through it. */}
        <rect x="0" y="0" width="24" height="24" fill="#000" />
        {ART[move]}
      </mask>
      <rect x="0" y="0" width="24" height="24" fill="currentColor" mask={`url(#${maskId})`} />
    </svg>
  );
}
