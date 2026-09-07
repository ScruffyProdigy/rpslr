import type { ReactElement } from 'react';

/**
 * The board's state markers, drawn rather than borrowed from the OS.
 *
 * These are the glyphs that sit *beside* the move icons — the cooldown
 * hourglass on a pill, the tick on a selected move, the winner's trophy. They
 * were emoji, which put the same three problems on the board that MoveIcon
 * exists to solve: they redraw differently on every platform, they carry their
 * own colour so they cannot be tinted, and `.cooldown-pill` sets
 * `font-family: var(--font-display)` — Archivo has no hourglass, so the pill
 * was rendering Archivo digits next to a system emoji font.
 *
 * Simpler than MoveIcon on purpose: no mask, because none of these needs a
 * hole cut in it. Plain `currentColor` fills, sized in `em` so they inherit
 * from whatever they sit in.
 */

export type UiIconName = 'hourglass' | 'check' | 'trophy' | 'close';

const ART: Record<UiIconName, ReactElement> = {
  /* A solid bowtie between two heavy caps. The pill renders this at 11px, and
     an outlined hourglass with a thin frame thins into a bare "I" at that size
     — so the shape is carried by filled mass, not stroke. The half-strength
     upper bulb reads as sand still to fall at 16px+ and simply disappears at
     11px, which costs nothing: the number beside it carries the meaning. */
  hourglass: (
    <>
      <path d="M5.6 2.2 H18.4 A1 1 0 0 1 18.4 4.4 H5.6 A1 1 0 0 1 5.6 2.2 Z" fill="currentColor" />
      <path d="M5.6 19.6 H18.4 A1 1 0 0 1 18.4 21.8 H5.6 A1 1 0 0 1 5.6 19.6 Z" fill="currentColor" />
      <path d="M7.4 4.4 H16.6 L12 11.4 Z" fill="currentColor" opacity="0.5" />
      <path d="M7.4 19.6 H16.6 L12 12.6 Z" fill="currentColor" />
    </>
  ),
  check: (
    <path
      d="M4.8 12.6 L9.6 17.4 L19.2 6.6"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  close: (
    <path
      d="M6.4 6.4 L17.6 17.6 M17.6 6.4 L6.4 17.6"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
    />
  ),
  /* Cup, handles, stem, base. */
  trophy: (
    <>
      <path d="M6.6 3.2 H17.4 V9.2 A5.4 5.4 0 0 1 6.6 9.2 Z" fill="currentColor" />
      <path
        d="M6.6 4.8 H4.2 A2.6 2.6 0 0 0 4.2 10 H5.6 M17.4 4.8 H19.8 A2.6 2.6 0 0 1 19.8 10 H18.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M12 14.6 V17.8"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path d="M7.6 18.6 H16.4 A1 1 0 0 1 16.4 20.8 H7.6 A1 1 0 0 1 7.6 18.6 Z" fill="currentColor" />
    </>
  ),
};

export default function UiIcon({
  name,
  className,
}: {
  name: UiIconName;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      data-ui-icon={name}
      /* Decorative: the pill carries an aria-label, the selected move is
         announced by aria-pressed, and the winner is named in text. */
      aria-hidden="true"
      focusable="false"
    >
      {ART[name]}
    </svg>
  );
}
