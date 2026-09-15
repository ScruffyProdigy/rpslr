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
import { AbilityRail } from './components/AbilityRail';
import { RevealCard } from './components/RevealCard';
import { heldAbilities, targetSteps } from './abilities';
import type { Loadout } from '@game/helpers/loadout';
import type { AbilityTargeting, Targeting } from './lib/useAbilityTargeting';
import type { Move, RoundResult } from './api';
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
/** One charge helper and a passive, which is what a helpers loadout brings. */
const HELPERS = ['rust', 'echo-chamber'] as unknown as Loadout;
/** The walk's handlers, which layout has no opinion about. */
const NO_WALK: AbilityTargeting = {
  targeting: null,
  note: null,
  isTargeting: () => false,
  start: () => {},
  name: () => {},
  cancel: () => {},
  confirm: () => {},
};

/** Rust naming one of their marked moves — the widest of the targeting panels. */
function rustWalk(): Targeting {
  const step = targetSteps('rust')[0];
  return {
    helperId: 'rust',
    name: 'Rust',
    step,
    named: {},
    side: 'opponent',
    legal: ['scissors'],
    instruction: 'Choose one of their moves for Rust',
    prompt: step.prompt,
    rejection: step.rejection,
  };
}

/**
 * The board as `App` assembles it: the reserved status slot, then the picker,
 * inside the same `.app`/`.board` wrappers that set the page's own width.
 * Copied in structure rather than rendering `<App>` itself, which would need a
 * socket, a match and a seat to say anything about layout.
 */
function Board({
  opponentLockedIn = false,
  centerSlot,
  theirDelays = NO_DELAYS,
  targeting = null,
  rail = false,
  myDelays = NO_DELAYS,
  recent = [],
  drawCardInPlay = false,
}: {
  opponentLockedIn?: boolean;
  centerSlot?: React.ReactNode;
  theirDelays?: Record<string, number>;
  /** A walk holding the board, as `useAbilityTargeting` hands one over. */
  targeting?: Targeting | null;
  /** Whether this is a helpers board, which puts the rail under the pentagon. */
  rail?: boolean;
  /** Your own marks, for the note that explains one of them. */
  myDelays?: Record<string, number>;
  recent?: Move[];
  /** Adds the draw caveat, which is the tallest the summary panel gets. */
  drawCardInPlay?: boolean;
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
          myDelays={myDelays}
          oppDelays={theirDelays}
          you={YOU}
          opponent={OPP}
          myChosenMove={null}
          lockedIn={false}
          opponentLockedIn={opponentLockedIn}
          disabled={false}
          round={1}
          myRecentMoves={recent}
          drawCardInPlay={drawCardInPlay}
          myOpeningDelays={NO_DELAYS}
          oppName={OPP.name}
          onPlay={() => {}}
          centerSlot={centerSlot}
          targeting={targeting}
        />
        {rail && (
          <AbilityRail
            held={heldAbilities(HELPERS, { rust: { marks: 0, available: true } })}
            unavailable={null}
            targeting={{ ...NO_WALK, targeting }}
          />
        )}
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

/**
 * Switching boards is a layout event as much as an interaction one: the strip
 * is paid for out of a page with 0.9px of slack, and their board carries a
 * wider centre panel and a pill on every marked node (JQ-324).
 */
describe('switching boards holds the layout', () => {
  it.each(WIDTHS)('keeps the pentagon exactly where it was at %ipx', async (width) => {
    await at(width, <Board />);
    const before = document.querySelector('.move-board')!.getBoundingClientRect();

    const [mine, theirs] = [...document.querySelectorAll<HTMLElement>('[role="tab"]')];
    theirs.click();
    await frame();
    const during = document.querySelector('.move-board')!.getBoundingClientRect();
    // The board is the tap surface. It moving under a thumb mid-decision is the
    // thing the reserved status slot exists to prevent, and a tab strip that
    // resized with its label would undo it.
    expect(during.top).toBe(before.top);
    expect(during.height).toBe(before.height);

    mine.click();
    await frame();
    const after = document.querySelector('.move-board')!.getBoundingClientRect();
    expect(after.top).toBe(before.top);
    expect(document.querySelectorAll('.move-btn')).toHaveLength(5);
  });

  it.each(WIDTHS)('does not overflow on their board at %ipx', async (width) => {
    await at(width, <Board theirDelays={{ rock: 2, paper: 1, scissors: 3, lizard: 1, robot: 4 }} />);
    document.querySelectorAll<HTMLElement>('[role="tab"]')[1].click();
    await frame();
    // A tapped move opens the widest panel their board has.
    document.querySelector<HTMLElement>('.move-btn')!.click();
    await frame();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    expect(escaping(document.querySelector<HTMLElement>('.board')!)).toEqual([]);
  });

  it.each(WIDTHS)('keeps the tabs reachable and tall enough at %ipx', async (width) => {
    await at(width, <Board />);
    const strip = [...document.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(strip).toHaveLength(2);
    for (const tab of strip) {
      const box = tab.getBoundingClientRect();
      expect(box.height, tab.textContent ?? '').toBeGreaterThanOrEqual(32);
      // Wide enough to hit without aiming: half the strip, less its gap.
      expect(box.width, tab.textContent ?? '').toBeGreaterThanOrEqual(100);
    }
  });
});

describe('naming a target holds the layout (JQ-325)', () => {
  const MARKED = { rock: 0, paper: 0, scissors: 2, lizard: 0, robot: 0 };

  it.each(WIDTHS)('does not overflow while an ability is naming at %ipx', async (width) => {
    await at(width, <Board theirDelays={MARKED} targeting={rustWalk()} rail />);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    expect(escaping(document.querySelector<HTMLElement>('.board')!)).toEqual([]);
  });

  it.each(WIDTHS)('does not move the pentagon when targeting opens at %ipx', async (width) => {
    // The instruction is in the centre slot rather than above the board for
    // exactly this reason: a banner would shift the tap surface, and the page
    // has 3.5px of slack at 375x812 to shift it into (JQ-324, JQ-325).
    const { rerender } = await at(width, <Board theirDelays={MARKED} rail />);
    const before = document.querySelector('.move-board')!.getBoundingClientRect();

    rerender(<Board theirDelays={MARKED} targeting={rustWalk()} rail />);
    await frame();
    const during = document.querySelector('.move-board')!.getBoundingClientRect();
    expect(during.top).toBe(before.top);
    expect(during.height).toBe(before.height);
  });

  /*
   * The centre panel is painted over the pentagon, and during targeting the
   * pentagon is what the player has to hit.
   *
   * Rectangles are not the question — every centre panel the board has drawn
   * since JQ-324 overlaps the lower nodes, harmlessly, because the panel is
   * `pointer-events: none` and an inspecting tap falls through it. What targeting
   * adds is real buttons in that panel, and `Cancel targeting` lands on two of
   * the five nodes at every width. So the question is what a tap actually reaches,
   * and `elementFromPoint` is the only thing that answers it.
   */
  it.each(WIDTHS)('puts the target under the tap, not the Cancel button at %ipx', async (width) => {
    await at(width, <Board theirDelays={MARKED} targeting={rustWalk()} rail />);
    const target = [...document.querySelectorAll<HTMLButtonElement>('.move-btn')].find(
      (b) => !b.disabled,
    )!;
    const box = target.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    expect(hit?.closest('.move-btn'), 'a tap on the legal target lands somewhere else').toBe(
      target,
    );
    expect(hit?.closest('.picker-center')).toBeNull();
  });

  /*
   * And it may not make the covering worse than the view it replaces. The
   * inspect panel is the shipped baseline: targeting swaps one panel for another
   * on the same board, so it owes no more of the pentagon than that one takes.
   */
  it.each(WIDTHS)('covers no move the inspect panel did not already cover at %ipx', async (width) => {
    const covered = () => {
      const box = document.querySelector<HTMLElement>('.picker-center')!.getBoundingClientRect();
      return new Set(
        [...document.querySelectorAll<HTMLElement>('.move-btn')]
          .filter((b) => {
            const r = b.getBoundingClientRect();
            return box.left < r.right && box.right > r.left && box.top < r.bottom && box.bottom > r.top;
          })
          .map((b) => b.getAttribute('data-move') ?? ''),
      );
    };
    const { unmount } = await at(width, <Board theirDelays={MARKED} />);
    document.querySelectorAll<HTMLElement>('[role="tab"]')[1].click();
    await frame();
    const baseline = covered();
    unmount();

    await at(width, <Board theirDelays={MARKED} targeting={rustWalk()} rail />);
    const now = [...covered()].filter((m) => !baseline.has(m));
    expect(now, 'targeting covers a node inspection leaves alone').toEqual([]);
  });

  it.each(WIDTHS)('offers only the legal target at %ipx', async (width) => {
    await at(width, <Board theirDelays={MARKED} targeting={rustWalk()} rail />);
    const enabled = [...document.querySelectorAll<HTMLButtonElement>('.move-btn')].filter(
      (b) => !b.disabled,
    );
    expect(enabled).toHaveLength(1);
    expect(enabled[0].dataset.move).toBe('scissors');
    // And it is still a target a thumb can hit.
    expect(enabled[0].getBoundingClientRect().height).toBeGreaterThanOrEqual(TAP_FLOOR[width]);
  });
});

describe('the rail says whose cards it holds (JQ-325)', () => {
  it.each([360, 390] as const)('shows the owner line at %ipx', async (width) => {
    await at(width, <Board rail />);
    const owner = document.querySelector<HTMLElement>('.ability-rail__owner')!;
    expect(owner.getBoundingClientRect().height).toBeGreaterThan(0);
    // A row of its own, above the cards rather than beside them — which is what
    // keeps the cards on the single row `boardFit` holds them to.
    const card = document.querySelector('.ability-card')!.getBoundingClientRect();
    expect(card.top).toBeGreaterThanOrEqual(owner.getBoundingClientRect().bottom);
  });

  it('takes it out of flow where the rail cannot afford it', async () => {
    await at(320, <Board rail />);
    const owner = document.querySelector<HTMLElement>('.ability-rail__owner')!;
    // Out of flow, not gone: the section is still named for a screen reader.
    expect(getComputedStyle(owner).position).toBe('absolute');
    expect(owner.getBoundingClientRect().height).toBeLessThanOrEqual(1);
    expect(document.querySelector('[aria-labelledby="ability-rail-owner"]')).not.toBeNull();
  });
});

/**
 * The strategy tip and the matchup summary, as rendered (JQ-326).
 *
 * Neither can be checked from the stylesheet. The tip's cost is a line count,
 * and the page it sits on had 0.9px of slack before this ticket. The summary's
 * cost is two boxes: the preview panel was already 0.8px clear of the top node's
 * tap target at 320px, so the panel that carries a summary is anchored below
 * that node rather than centred, and only a browser can say whether that worked.
 */
describe('the beginner guidance fits the board it teaches', () => {
  /** Mark one-time notes as dismissed, so the next one in the queue renders. */
  function seen(...notes: string[]) {
    for (const note of notes) window.localStorage.setItem(`rpslr.seen.${note}`, '1');
  }

  /** The move buttons the centre panel is painted over. */
  function covered(): string[] {
    const box = document.querySelector<HTMLElement>('.picker-center')!.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>('.move-btn')]
      .filter((b) => {
        const r = b.getBoundingClientRect();
        return box.left < r.right && box.right > r.left && box.top < r.bottom && box.bottom > r.top;
      })
      // The name span, not the button's text: a marked move's button also
      // carries its cooldown count, and "Robot 2" would not match "Robot".
      .map((b) => b.querySelector('.move-btn__name')?.textContent?.trim() ?? '');
  }

  /** Preview the top node — the one the board has always kept readable. */
  async function previewRock() {
    document.querySelector<HTMLElement>('.move-btn')!.click();
    await frame();
    // Really the summary panel, not the idle one this would otherwise pass on.
    expect(document.querySelector('.picker-center__summary')).not.toBeNull();
  }

  afterEach(() => window.localStorage.clear());

  it.each(WIDTHS)(
    'costs the note slot no more than the note it queues behind at %ipx',
    async (width) => {
      // `boardFit.test.ts` budgets the note slot at the cooldown explainer's two
      // lines, measured in this browser. The tip shares the slot, so the budget
      // covers it exactly as long as it is no taller — an invariant that survives
      // a change to the type scale, which a hard-coded 49px would not.
      seen('tapHint', 'strategyTip');
      await at(width, <Board myDelays={{ rock: 2 }} recent={['rock']} />);
      const explainer = document.querySelector<HTMLElement>('.picker-note')!;
      expect(explainer.textContent).toMatch(/back in 2 turns/);
      const budget = explainer.getBoundingClientRect().height;
      cleanup();

      window.localStorage.clear();
      seen('tapHint');
      await at(width, <Board />);
      const tip = document.querySelector<HTMLElement>('.picker-note')!;
      expect(tip.textContent).toMatch(/to see what they can play/);
      expect(tip.getBoundingClientRect().height).toBeLessThanOrEqual(budget);
    },
  );

  it.each(WIDTHS)('leaves the move it is describing readable at %ipx', async (width) => {
    // The panel grows downwards from under the top node precisely so that the
    // move being previewed — which is also the move that has grown under the
    // preview scale — is not the one the explanation hides.
    await at(width, <Board />);
    await previewRock();
    expect(covered()).not.toContain('Rock');
  });

  it.each(WIDTHS)('covers no move the board did not already cover at %ipx', async (width) => {
    // The four lower nodes are under every panel the centre has ever drawn, the
    // one-line "why is this down?" included. Matching that is the bar: a summary
    // is not licence to take more of the board than the board already gives.
    await at(width, <Board myDelays={{ ...NO_DELAYS, robot: 2 }} recent={['robot']} />);
    [...document.querySelectorAll<HTMLElement>('.move-btn')]
      .find((b) => /Robot/.test(b.textContent ?? ''))!
      .click();
    await frame();
    const already = new Set(covered());
    cleanup();

    await at(width, <Board />);
    await previewRock();
    for (const name of covered()) expect([...already]).toContain(name);
  });

  it.each(WIDTHS)('stays inside the board with every clause showing at %ipx', async (width) => {
    // The tallest the panel gets: all three clauses filled and the draw caveat
    // under them. 320px is where it hangs lowest, and past the board's bottom
    // edge is the legend, so overrunning it is a real defect rather than an
    // untidy number.
    //
    // The margin is a line of text rather than a pixel count, and that is the
    // whole point of it. This started as a bare `<= board.bottom`, which passed
    // here by 4.8px and failed on CI by 19px: the app's fonts are not installed
    // there, the fallback is wider, and the rules caption wraps one line more.
    // Neither font stack is the real one — phones have their own — so what has
    // to hold is that the panel survives a wrap it did not plan for, whoever is
    // rendering it. Sizing the slack in line-heights says that directly, and
    // keeps saying it if the type scale moves.
    await at(width, <Board drawCardInPlay />);
    await previewRock();
    const panel = document.querySelector<HTMLElement>('.picker-center')!;
    expect(panel.querySelectorAll('.picker-center__summary li')).toHaveLength(3);
    expect(panel.textContent).toMatch(/could still draw it/);

    const caption = panel.querySelector<HTMLElement>('.picker-center__caption')!;
    const lineHeight = parseFloat(getComputedStyle(caption).lineHeight);
    expect(lineHeight).toBeGreaterThan(0);

    const board = document.querySelector<HTMLElement>('.move-board')!.getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    expect(box.top).toBeGreaterThanOrEqual(board.top);
    expect(board.bottom - box.bottom).toBeGreaterThanOrEqual(lineHeight);
  });

  it.each(WIDTHS)('does not overflow with the summary open at %ipx', async (width) => {
    await at(width, <Board />);
    await previewRock();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    expect(escaping(document.querySelector<HTMLElement>('.board')!)).toEqual([]);
  });
});

