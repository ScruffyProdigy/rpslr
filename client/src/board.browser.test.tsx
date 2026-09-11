/**
 * The board, laid out by a real browser (JQ-158).
 *
 * `boardFit.test.ts` covers what can be answered from the stylesheet alone: it
 * evaluates the real `min()`/`clamp()` arithmetic, so tap-target size and board
 * width are protected without paying for a browser. What it cannot do is see
 * layout — and four of the board's promises are layout and nothing else:
 *
 *  - no horizontal overflow, which is a fact about boxes, not declarations
 *  - tap targets meeting their floors *as rendered*. The pentagon is sized in
 *    `cqw` against `container-type: inline-size`, which jsdom does not
 *    implement at all, so the unit test has to model the container itself
 *  - the pentagon not moving when the "opponent locked in" pill appears. The
 *    reserved slot is `min-height` on `.board-status` plus a margin reset on
 *    `.board-status > *`, and the reset is one line that is easy to delete by
 *    accident. Its guarantee was one hand measurement showing 0px
 *  - the reveal card's contents fitting inside it. The avatars and move glyphs
 *    were enlarged on a measurement, not on a check that survives
 *
 * Each was verified once by hand. This is that measurement, kept.
 */

import { page } from '@vitest/browser/context';
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MovePicker } from './components/MovePicker';
import { RevealCard } from './components/RevealCard';
import type { RoundResult } from './api';
import './styles.css';

/** The widths the board claims to support, narrowest first. */
const WIDTHS = [320, 360, 390] as const;

/**
 * Phase 2's floor, per width: 56px at 360 and up, 48px at 320. The same pair
 * `boardFit.test.ts` reads off the stylesheet — asserted here against the boxes
 * the browser actually painted.
 */
const TAP_FLOOR: Record<number, number> = { 320: 48, 360: 56, 390: 56 };

const YOU = { profile: null, name: 'Ada', placeholder: false };
const OPP = { profile: null, name: 'Grace', placeholder: false };
const NO_DELAYS = { rock: 0, paper: 0, scissors: 0, lizard: 0, robot: 0 };

/**
 * The board as `App` assembles it: the reserved status slot, then the picker,
 * inside the same `.app`/`.board` wrappers that set the page's own width.
 * Copied in structure rather than rendering `<App>` itself, which would need a
 * socket, a match and a seat to say anything about layout.
 */
function Board({
  opponentLockedIn = false,
  centerSlot,
}: {
  opponentLockedIn?: boolean;
  centerSlot?: React.ReactNode;
}) {
  return (
    <div className="app">
      <div className="board">
        <div className="board-status" role="status">
          {opponentLockedIn && (
            <p className="hint opponent-ready">Opponent has locked in — pick your move!</p>
          )}
        </div>
        <MovePicker
          myDelays={NO_DELAYS}
          oppDelays={NO_DELAYS}
          myChosenMove={null}
          lockedIn={false}
          opponentLockedIn={opponentLockedIn}
          disabled={false}
          round={1}
          myRecentMoves={[]}
          myOpeningDelays={NO_DELAYS}
          oppName={OPP.name}
          onPlay={() => {}}
          centerSlot={centerSlot}
        />
      </div>
    </div>
  );
}

/** One animation frame — long enough for the container query to have resolved. */
const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

/**
 * Lay the page out at `width`, render `ui`, and let it settle before anything is
 * measured.
 *
 * Waiting on the animations rather than on a timeout, because the reveal card
 * enters under a transform: measured a frame in, it reported a box 30px narrower
 * than its own layout width and its avatars a tenth of a pixel outside it. That
 * is the animation, not the layout, and a sleep long enough to dodge it would be
 * a sleep long enough to go flaky on a slower CI box.
 */
async function at(width: number, ui: React.ReactElement) {
  await page.viewport(width, 844);
  const utils = render(ui);
  await frame();
  await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
  await frame();
  return utils;
}

/**
 * Every element inside `root` that is painted outside `root`'s own box.
 *
 * Rects rather than `scrollWidth`, which answers a different question: the
 * pentagon's glow (`.move-board::before`) is a `pointer-events: none`,
 * `opacity: 0` radial inset 22% *past* the board on every side, and `.board` is
 * `overflow-x: clip`, so it inflates `scrollWidth` by ~46px while nothing
 * scrolls and nothing is visible. What overflow means here is a box a thumb
 * could reach that the board does not contain.
 *
 * Zero-area nodes are skipped: `<marker>` and `<mask>` in the arrow SVG's
 * `<defs>` are never laid out and every one of them reports a rect at the
 * origin, which is outside everything.
 */
function escaping(root: HTMLElement): string[] {
  const box = root.getBoundingClientRect();
  return [...root.querySelectorAll<HTMLElement>('*')]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      return r.right > box.right + 0.5 || r.left < box.left - 0.5;
    })
    .map((el) => `${el.tagName.toLowerCase()}.${el.getAttribute('class') ?? ''}`);
}

afterEach(cleanup);

describe('the board fits a phone, as rendered', () => {
  it.each(WIDTHS)('has no horizontal overflow at %ipx', async (width) => {
    await at(width, <Board />);
    // The page first: nothing may make the document itself scroll sideways.
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    // Then the board, which is the box the phone actually has to hold. A child
    // reaching past it is the shape this catches even when an ancestor clips it.
    expect(escaping(document.querySelector<HTMLElement>('.board')!)).toEqual([]);
  });

  it.each(WIDTHS)('keeps every tap target at its floor at %ipx', async (width) => {
    await at(width, <Board />);
    const buttons = [...document.querySelectorAll<HTMLElement>('.move-btn')];
    // Five moves. A pentagon that lost one would otherwise pass this vacuously.
    expect(buttons).toHaveLength(5);
    for (const button of buttons) {
      const box = button.getBoundingClientRect();
      expect(box.width, button.textContent ?? '').toBeGreaterThanOrEqual(TAP_FLOOR[width]);
      expect(box.height, button.textContent ?? '').toBeGreaterThanOrEqual(TAP_FLOOR[width]);
    }
  });
});

describe('the reserved status slot holds the board still', () => {
  it.each(WIDTHS)('does not move the pentagon when the pill appears at %ipx', async (width) => {
    await at(width, <Board />);
    const before = document.querySelector('.move-board')!.getBoundingClientRect().top;
    cleanup();

    await at(width, <Board opponentLockedIn />);
    // The pill is really there — otherwise this compares two identical boards.
    expect(document.querySelector('.hint.opponent-ready')).not.toBeNull();
    const after = document.querySelector('.move-board')!.getBoundingClientRect().top;

    // 0px, not "close enough": the slot is sized to the pill precisely so this
    // is exact, and a margin creeping back in would show up as a few px.
    expect(after).toBe(before);
  });
});

describe('the reveal card holds its own contents', () => {
  const result: RoundResult = {
    round: 2,
    outcome: 'a',
    moves: { 'player-a': 'paper', 'player-b': 'robot' },
    autoPicked: [],
  };

  it('fits its contents at the narrowest supported width', async () => {
    await at(
      WIDTHS[0],
      <Board
        centerSlot={
          <RevealCard
            result={result}
            phase="card"
            mySeatKey="a"
            myPlayerId="player-a"
            you={YOU}
            opponent={OPP}
            onSkip={() => {}}
          />
        }
      />,
    );

    const card = document.querySelector<HTMLElement>('.reveal-card')!;
    // Nothing spilling out of the card in either axis.
    expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth);
    expect(card.scrollHeight).toBeLessThanOrEqual(card.clientHeight);

    // And the pieces that were enlarged on a measurement — the avatars, the
    // move glyphs, the verdict — inside the card's own box rather than merely
    // not scrolling it.
    const box = card.getBoundingClientRect();
    const parts = card.querySelectorAll<HTMLElement>(
      '.reveal-card__side, .reveal-card__move, .reveal-card__verb, .reveal-card__verdict',
    );
    expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) {
      const rect = part.getBoundingClientRect();
      expect(rect.left, part.className).toBeGreaterThanOrEqual(box.left - 0.5);
      expect(rect.right, part.className).toBeLessThanOrEqual(box.right + 0.5);
      expect(rect.top, part.className).toBeGreaterThanOrEqual(box.top - 0.5);
      expect(rect.bottom, part.className).toBeLessThanOrEqual(box.bottom + 0.5);
    }
  });
});
