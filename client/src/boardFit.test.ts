import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Read from disk rather than importing: vitest runs with `css: false`, which
// stubs CSS imports (including `?raw`) to an empty string.
const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

/**
 * Phase 2 promised tap targets ≥ 56px at 360px, ≥ 48px at 320px, and no
 * horizontal overflow — and nothing checked it, because the board is sized by
 * container queries (`cqw`) that jsdom does not evaluate at all.
 *
 * So this reads the shipped CSS and evaluates the real `min()` / `clamp()`
 * arithmetic. It is not a copy of the numbers: change `styles.css` and this
 * moves with it. It cannot see full-page layout — that still needs a browser —
 * but it does hold the two constraints that actually make the board tappable.
 */

/**
 * The stylesheet split into the top level and each `@media` block, in source
 * order. A rule inside a media block only counts when the block's query holds
 * at the viewport being modelled, and later rules win — which is the cascade
 * for the single-class selectors this file reads.
 */
type Layer = { query: string | null; body: string };

function layers(): Layer[] {
  const out: Layer[] = [];
  let plain = '';
  let i = 0;
  for (;;) {
    const at = css.indexOf('@media', i);
    if (at === -1) {
      plain += css.slice(i);
      out.push({ query: null, body: plain });
      return out;
    }
    // Flush the top-level run before this block, so source order survives.
    plain += css.slice(i, at);
    out.push({ query: null, body: plain });
    plain = '';
    const open = css.indexOf('{', at);
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    out.push({ query: css.slice(at + '@media'.length, open).trim(), body: css.slice(open + 1, j - 1) });
    i = j;
  }
}

const LAYERS = layers();

/**
 * Whether a media query holds at `viewport`. Only width queries are modelled;
 * anything else (`hover`, `prefers-reduced-motion`) is skipped rather than
 * guessed at, so a rule behind one is simply never read here.
 */
function holdsAt(query: string, viewport: number): boolean {
  const terms = [...query.matchAll(/\((min|max)-width:\s*(\d+)px\)/g)];
  if (terms.length === 0) return false;
  // A query with a feature we do not model is not safe to evaluate.
  const modelled = query.replace(/\((min|max)-width:\s*\d+px\)/g, '').replace(/[\s()and,]/g, '');
  if (modelled !== '') return false;
  return terms.every(([, dir, px]) =>
    dir === 'max' ? viewport <= Number(px) : viewport >= Number(px),
  );
}

/**
 * The value of one declaration for `selector` as it resolves at `viewport`,
 * e.g. `.move-btn` → `width`. Without a viewport only the top level is read.
 */
function declaration(selector: string, prop: string, viewport = Infinity): string {
  const pattern = new RegExp(`(?:^|\\n)${selector.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`);
  const inner = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`);
  let seen = false;
  let value: string | null = null;
  for (const layer of LAYERS) {
    if (layer.query !== null && !holdsAt(layer.query, viewport)) continue;
    // Media blocks indent their rules, so match against a dedented copy.
    const rule = pattern.exec(layer.query === null ? layer.body : layer.body.replace(/\n[ \t]+/g, '\n'));
    if (!rule) continue;
    seen = true;
    // Strip comments first, or a commented declaration reads as missing.
    const found = inner.exec(rule[1].replace(/\/\*[\s\S]*?\*\//g, ''));
    if (found) value = found[1].trim();
  }
  if (!seen) throw new Error(`styles.css has no rule for ${selector}`);
  if (value === null) throw new Error(`${selector} no longer declares ${prop}`);
  return value;
}

/** Split on top-level commas only, so nested functions survive. */
function args(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of inner) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  return [...out, cur].map((s) => s.trim());
}

/** Resolve a length against a container width. `%` and `cqw` both use it. */
export function resolvePx(value: string, container: number): number {
  const v = value.trim();
  const fn = /^(min|max|clamp)\((.*)\)$/s.exec(v);
  if (fn) {
    const parts = args(fn[2]).map((p) => resolvePx(p, container));
    if (fn[1] === 'min') return Math.min(...parts);
    if (fn[1] === 'max') return Math.max(...parts);
    const [lo, mid, hi] = parts;
    return Math.min(Math.max(mid, lo), hi);
  }
  // The safe-area insets are the padding a notch or home indicator adds. They
  // are zero on the viewports modelled here and can only ever add, so a budget
  // that resolves them to zero is the loosest the layout ever gets.
  if (/^env\([^)]*\)$/.test(v)) return 0;
  const calc = /^calc\((.*)\)$/s.exec(v);
  if (calc) {
    const terms = calc[1].split(/\s(?=[+-]\s)/);
    return terms.reduce((sum, term) => {
      const signed = /^([+-])\s+(.*)$/s.exec(term);
      if (!signed) return sum + resolvePx(term, container);
      const magnitude = resolvePx(signed[2], container);
      return signed[1] === '+' ? sum + magnitude : sum - magnitude;
    }, 0);
  }
  // A zero length is allowed to drop its unit, and CSS is written that way.
  if (/^-?0(\.0+)?$/.test(v)) return 0;
  const num = /^(-?[\d.]+)(px|%|cqw)$/.exec(v);
  if (!num) throw new Error(`cannot resolve length: ${value}`);
  const n = Number(num[1]);
  return num[2] === 'px' ? n : (n / 100) * container;
}

/** Width available inside the app's horizontal padding and its max-width. */
function contentWidth(viewport: number): number {
  const pad = declaration('.app', 'padding-left', viewport);
  if (!pad.includes('16px')) throw new Error(`.app padding-left changed: ${pad}`);
  return Math.min(resolvePx(declaration('.app', 'max-width', viewport), viewport), viewport - 32);
}

/** The px width in a `border: 1px solid …` shorthand. */
function borderPx(selector: string, viewport: number): number {
  const value = declaration(selector, 'border', viewport);
  const px = /(-?[\d.]+)px/.exec(value);
  if (!px) throw new Error(`${selector} border is not a px width: ${value}`);
  return Number(px[1]);
}

/**
 * The width the pentagon's `100%` actually resolves against: the card's
 * content box, inside its own padding and border. Measuring from `.app` alone
 * overstates the board by that padding — harmless while only tap targets were
 * at stake, but the pentagon is square, so its width is also its height, and
 * the height is now on a budget (JQ-165).
 */
function boardInnerWidth(viewport: number): number {
  const inner = contentWidth(viewport);
  const pad = resolvePx(declaration('.board', 'padding-inline', viewport), inner);
  return inner - 2 * pad - 2 * borderPx('.board', viewport);
}

/**
 * The pentagon's declared width, with the two things `resolvePx` cannot see
 * substituted first: `svh` (the viewport with browser toolbars expanded) and
 * the `--board-furniture` custom property.
 *
 * `viewportHeight` defaults to Infinity, which makes the `svh` term drop out of
 * the `min()` — that isolates the width behaviour JQ-108 cares about. Pass a
 * real height to model a phone.
 */
function boardWidth(viewport: number, viewportHeight = Infinity): number {
  // Looked up only when the width actually references it: above 560px the
  // pentagon is sized by width alone and the property is not declared at all.
  const declared = declaration('.move-board', 'width', viewport)
    .replace(/var\(--board-furniture\)/g, () =>
      `${resolvePx(declaration(':root', '--board-furniture', viewport), 0)}px`,
    )
    .replace(/([\d.]+)svh/g, (_, n) =>
      Number.isFinite(viewportHeight) ? `${(Number(n) / 100) * viewportHeight}px` : '100000px',
    );
  return resolvePx(declared, boardInnerWidth(viewport));
}

function buttonSize(viewport: number, viewportHeight = Infinity): number {
  return resolvePx(declaration('.move-btn', 'width', viewport), boardWidth(viewport, viewportHeight));
}

/**
 * Everything on the page that is not the pentagon. Measured constant at 489.1px
 * across every pentagon size, which is what makes the pentagon able to absorb
 * whatever height is left over.
 */
function furnitureHeight(viewport: number): number {
  return pageHeight(viewport) - boardWidth(viewport);
}

/**
 * The height a phone actually gives a web page, which is not its screen height:
 * iOS Safari spends roughly 100px on the status bar and the toolbars, and that
 * is the state the page is in when it first paints. JQ-165 was first "fixed"
 * against the screen height and still overflowed on a real iPhone.
 *
 * The fix does not depend on this number — `svh` makes the browser report it —
 * so this only sets how strict the test is. Re-measure with `innerHeight` on a
 * device if it needs to be exact.
 */
const SAFARI_CHROME = 100;

/** Smallest square that still keeps a move button at JQ-108's 56px floor. */
const MIN_PENTAGON = 205;

describe('resolvePx', () => {
  it('resolves px, percentages and container units', () => {
    expect(resolvePx('104px', 300)).toBe(104);
    expect(resolvePx('50%', 300)).toBe(150);
    expect(resolvePx('27.4cqw', 400)).toBeCloseTo(109.6);
  });

  it('resolves min and clamp', () => {
    expect(resolvePx('min(100%, 380px)', 500)).toBe(380);
    expect(resolvePx('min(100%, 380px)', 300)).toBe(300);
    expect(resolvePx('clamp(1px, 50%, 10px)', 100)).toBe(10);
    expect(resolvePx('clamp(20px, 50%, 100px)', 100)).toBe(50);
  });
});

describe('the board fits a phone (JQ-108)', () => {
  it.each([
    [390, 56],
    [360, 56],
    [320, 48],
  ])('viewport %ipx keeps tap targets at or above %ipx', (viewport, floor) => {
    expect(buttonSize(viewport)).toBeGreaterThanOrEqual(floor);
  });

  it.each([320, 360, 390, 414])('does not overflow at %ipx', (viewport) => {
    expect(boardWidth(viewport)).toBeLessThanOrEqual(boardInnerWidth(viewport));
  });

  it('stops growing once there is room, so the board never dominates a desktop', () => {
    expect(boardWidth(1400)).toBe(380);
  });
});


/**
 * Text block heights in px, measured in Chromium with the app's own fonts.
 * vitest runs in jsdom, which does no layout at all, so a line box cannot be
 * derived from the stylesheet — but every margin, padding, gap, border and box
 * size around one can be, and those are what drifted in JQ-165. Re-measure
 * these if the type scale moves.
 */
const TEXT = {
  // One line. The Lobby link shortens to "← Lobby" below 560px, which leaves
  // the row 71.3px of slack at 390px rather than 7.7px, so it holds to roughly
  // a 1.24x text scale. Past that it wraps and the pentagon absorbs the extra
  // line through the `svh` cap — smaller board, still no scrolling.
  topbar: 34, // .topbar
  ruleNote: 15.5, // .rule-note--board, one line at 0.78rem
  seatLabel: 13.5, // .player-label at 0.7rem
  seatName: 19.5, // .player-name at 1rem
  winPips: 18.4, // .win-pip is 1.15rem across
  roundLabel: 18, // .round-label at 1rem
  // .graph-legend, two lines at 0.72rem / 1.7. Measured against the *helpers*
  // legend, which is the longer of the two — it carries one extra entry for a
  // loadout's added edge (JQ-151). `the legend stays within two lines` below
  // pins the copy that was measured, so growing it fails there rather than
  // silently pushing the board off a 360px screen.
  legend: 39.2,
  // The cooldown explainer, not the tap hint: they are mutually exclusive, and
  // a player who has already dismissed the tap hint — everyone after their
  // first match — gets this one, which is two lines rather than one.
  pickerNote: 49, // .picker-note, cooldown explainer
} as const;

/**
 * The avatar the seat card actually renders. It shares `--lg` with the
 * match-end winner, which has a screen to itself; the scoreboard is allowed to
 * narrow its own copy, and does, because it is the block that gives when the
 * board has to fit a phone.
 */
function seatAvatar(viewport: number): number {
  try {
    return resolvePx(declaration('.player .player-avatar--lg', 'width', viewport), 0);
  } catch {
    return resolvePx(declaration('.player-avatar--lg', 'width', viewport), 0);
  }
}

/**
 * How tall the page runs for a Lobby-seated player in round 1: both seats
 * filled, the round-1 rule note showing, and the one-time tap hint still
 * showing. That is the worst case, and it is the state a first-time player
 * lands in — the one most likely to be thrown by a board that scrolls — so it
 * is the case the budget is held to.
 *
 * A Lobby player gets no `.match-head` (`!match.externalMatchId`), no debug
 * banner, no status row and no footer, so the ledger below is the whole page.
 */
function pageHeight(viewport: number): number {
  const px = (selector: string, prop: string) =>
    resolvePx(declaration(selector, prop, viewport), contentWidth(viewport));
  const movesGap = px('.moves', 'gap');
  const pickerGap = px('.move-picker', 'gap');

  return (
    px('.app', 'padding-top') +
    TEXT.topbar +
    // The board card: border and padding on both edges.
    2 * borderPx('.board', viewport) +
    2 * px('.board', 'padding-block') +
    px('.rule-note--board', 'margin-top') +
    TEXT.ruleNote +
    // The scoreboard: two seat cards side by side, so one card's height.
    2 * px('.scoreboard', 'margin-block') +
    2 * borderPx('.player', viewport) +
    2 * px('.player', 'padding-block') +
    seatAvatar(viewport) +
    3 * px('.player', 'gap') +
    TEXT.seatLabel +
    TEXT.seatName +
    px('.win-pips', 'margin-top') +
    TEXT.winPips +
    // The moves block: round label, the reserved status slot, then the picker.
    TEXT.roundLabel +
    px('.round-label', 'margin-bottom') +
    movesGap +
    px('.board-status', 'min-height') +
    movesGap +
    px('.move-board', 'margin-top') +
    boardWidth(viewport) + // square, so its width is its height
    px('.move-board', 'margin-bottom') +
    pickerGap +
    px('.graph-legend', 'margin-top') +
    TEXT.legend +
    pickerGap +
    TEXT.pickerNote +
    px('.app', 'padding-bottom')
  );
}

describe('the board does not scroll on a phone (JQ-165)', () => {
  // The first fix budgeted against the screen height and still overflowed on a
  // real iPhone, because a phone does not give a page its screen height. These
  // hold the layout to what Safari actually leaves.
  it.each([
    [390, 844],
    [375, 812],
  ])('leaves the pentagon a usable size on a %ix%i phone', (viewport, screen) => {
    const usable = screen - SAFARI_CHROME;
    expect(furnitureHeight(viewport) + MIN_PENTAGON).toBeLessThanOrEqual(usable);
  });

  it.each([
    [390, 844],
    [375, 812],
  ])('fits everything, legend and note included, on a %ix%i phone', (viewport, screen) => {
    const usable = screen - SAFARI_CHROME;
    expect(furnitureHeight(viewport) + boardWidth(viewport, usable)).toBeLessThanOrEqual(usable);
  });

  it('keeps the declared furniture constant honest', () => {
    // `.move-board` subtracts --board-furniture from the viewport, so if that
    // number drifts from what the rest of the page actually costs, the pentagon
    // is sized against a lie and the page overflows again. Recomputed here from
    // the same stylesheet, so the two cannot separate silently.
    const declared = resolvePx(declaration(':root', '--board-furniture', 390), 0);
    expect(declared).toBeGreaterThanOrEqual(furnitureHeight(390));
    expect(declared - furnitureHeight(390)).toBeLessThan(2);
  });

  it('never shrinks the pentagon below a 56px tap target', () => {
    // The floor in the width `max()` is what protects JQ-108 once height, not
    // width, is the binding constraint. 240px is shorter than any phone.
    expect(buttonSize(390, 240)).toBeGreaterThanOrEqual(56);
    expect(boardWidth(390, 240)).toBe(MIN_PENTAGON);
  });

  it('keeps the cooldown pill clear of the move name on a shrunken board', () => {
    // Measured in a browser, since the clearance depends on line boxes jsdom
    // cannot compute: 6.2px at a 270px board (what a 390x760 Safari viewport
    // gives) and 10px at the full 380px. What is checkable from here is the
    // two values that produce it. Before this, the pill hung at -7px with a
    // 1.4 line-height and overlapped the name on any board under 245px.
    const pill = '.move-btn .cooldown-pill';
    expect(resolvePx(declaration(pill, 'bottom', 390), 0)).toBeLessThanOrEqual(-10);
    expect(Number(declaration(pill, 'line-height', 390))).toBeLessThanOrEqual(1.2);
  });

  it('spends the space on the scoreboard before the pentagon', () => {
    // The seat cards compress first: on a viewport with room, the pentagon is
    // still sized by the width it has, exactly as JQ-108 left it.
    expect(boardWidth(390)).toBe(boardInnerWidth(390));
    expect(seatAvatar(390)).toBeLessThan(
      resolvePx(declaration('.player-avatar--lg', 'width'), 0),
    );
  });
});



/**
 * The ability rail's text blocks, measured in Chromium at the board's real
 * content-box width with the app's own fonts — the same method, and the same
 * reason, as `TEXT` above: jsdom does no layout, so a line box cannot be derived
 * from the stylesheet, while every box, gap, border and min-height around one
 * can be, and those are what drift.
 *
 * Worst case throughout, as the duel ledger is: the roster's longest ability
 * blurb (Sacrifice, 76 characters) on a card that is also carrying a blocked
 * reason under its fire button — "You have already fired … this round.", which
 * is the state a player is in for the rest of any round they fire in.
 */
const RAIL_TEXT = {
  /** `.ability-card__head` — the name and the charge word share one baseline row. */
  head: 16.5,
  /** `.ability-card__blurb`, three lines on a 154px card or wider, four below it. */
  blurb3: 44.9,
  blurb4: 59.9,
  /** `.ability-card__blocked`, two lines on a 147px card or wider, three below it. */
  blocked2: 29,
  blocked3: 43.5,
} as const;

/** The rule the fire button shares with the confirm and cancel buttons. */
const RAIL_BUTTONS = '.ability-card__fire,\n.ability-confirm__go,\n.ability-card__cancel';

/** The `flex` shorthand's basis, e.g. `1 1 126px` → 126. */
function flexBasis(selector: string, viewport: number): number {
  const value = declaration(selector, 'flex', viewport);
  return resolvePx(value.trim().split(/\s+/).pop() ?? '', boardInnerWidth(viewport));
}

/**
 * One card's width with both cards on one row, which is the only arrangement
 * the height below models — `keeps both cards on one row` is what holds it.
 */
function cardWidth(viewport: number): number {
  const gap = resolvePx(declaration('.ability-rail', 'gap', viewport), 0);
  return (boardInnerWidth(viewport) - gap) / 2;
}

/** The tallest card the roster can put on the rail, from the stylesheet. */
function railHeight(viewport: number): number {
  const width = cardWidth(viewport);
  const px = (selector: string, prop: string) =>
    resolvePx(declaration(selector, prop, viewport), width);
  const gap = px('.ability-card', 'gap');
  return (
    2 * borderPx('.ability-card', viewport) +
    2 * px('.ability-card', 'padding') +
    RAIL_TEXT.head +
    gap +
    (width >= 154 ? RAIL_TEXT.blurb3 : RAIL_TEXT.blurb4) +
    gap +
    px(RAIL_BUTTONS, 'min-height') +
    gap +
    (width >= 147 ? RAIL_TEXT.blocked2 : RAIL_TEXT.blocked3)
  );
}

/**
 * What the rail costs the page: its own height plus both spacings above it. The
 * `.moves` row gap and the rail's own `margin-top` compose rather than collapse,
 * this being a flex column, so the rail starts 20px below the one-time note.
 */
function railBlock(viewport: number): number {
  const px = (selector: string, prop: string) =>
    resolvePx(declaration(selector, prop, viewport), contentWidth(viewport));
  return px('.moves', 'gap') + px('.ability-rail', 'margin-top') + railHeight(viewport);
}

/**
 * The two phones JQ-165 promised a duel board would not scroll on, so the two
 * modes are compared on the same screens.
 */
const PHONES = [
  [390, 844],
  [375, 812],
] as const;

/**
 * Those two plus the narrowest screen the board claims at all (JQ-108). A duel
 * board already scrolls on that one — 568px leaves less than the pentagon's own
 * floor, so the floor wins and the page overflows, which the `.move-board`
 * comment allows in as many words. Nothing about the fold can be asserted there;
 * what can is that the rail stays a rail.
 */
const ALL_PHONES = [...PHONES, [320, 568]] as const;

describe('the ability rail is inside the budget (JQ-254)', () => {
  // The ledger above is the duel page: `duel` brings the null loadout, so it has
  // no rail to measure and the budget had no term for one. These add it. What
  // they hold is not that a helpers board fits — it cannot, and styles.css says
  // why — but that the rail is the only thing that does not.
  it.each(ALL_PHONES)('keeps both cards on one row at %ix%i', (viewport) => {
    // `flex-wrap: wrap` makes the rail's height a cliff rather than a curve: the
    // moment two bases plus the gap exceed the row, the cards stack and the rail
    // very nearly doubles. Held against the board's real content box, not
    // against the viewport, because that box is what the cards are laid in.
    const gap = resolvePx(declaration('.ability-rail', 'gap', viewport), 0);
    expect(2 * flexBasis('.ability-card', viewport) + gap).toBeLessThanOrEqual(
      boardInnerWidth(viewport),
    );
  });

  it.each(PHONES)('leaves the rail, and only the rail, below the fold on a %ix%i phone', (viewport, screen) => {
    // Only JQ-165's two phones: on a 320x568 there is no fold to keep, because a
    // duel board already scrolls there.
    const usable = screen - SAFARI_CHROME;
    const throughNote = furnitureHeight(viewport) + boardWidth(viewport, usable);
    // Nothing a duel board promises moves. The pentagon is sized against the
    // same furniture constant in both modes, so the scoreboard, the legend and
    // the one-time note sit exactly where they sit in a duel — which is the
    // whole of what a helpers board still guarantees above the fold.
    expect(throughNote).toBeLessThanOrEqual(usable);
    // And it does not fit with the rail, on any of these phones. This is the
    // decision, not a lament: if it ever passes — a shorter rail, a taller
    // phone — the allowance recorded in styles.css is stale and the promise
    // should be tightened to match rather than left as a comment that lies.
    expect(throughNote + railBlock(viewport)).toBeGreaterThan(usable);
  });

  it.each(ALL_PHONES)('keeps the rail shorter than the board it serves at %ix%i', (viewport, screen) => {
    // The bound that makes "it scrolls" a decision rather than an open end: the
    // rail is a secondary surface reached by scrolling, so it may not outgrow
    // the pentagon it sits under. This is the one the stacking broke — 284px of
    // rail below a 205px board on a 320px phone.
    const usable = screen - SAFARI_CHROME;
    expect(railHeight(viewport)).toBeLessThanOrEqual(boardWidth(viewport, usable));
  });

  it.each([
    [390, 844, 56],
    [375, 812, 56],
    [360, 640, 56],
    [320, 568, 48],
  ])('keeps a move button past its floor at %ix%i (>= %ipx)', (viewport, screen, floor) => {
    // JQ-108's floor is not what pays for the rail: the pentagon is sized as it
    // is in a duel, so these hold for the same reason they hold there. Restated
    // here because "shrink the pentagon to make room" is the fix this ticket
    // considered and rejected, and this is what it would have spent.
    expect(buttonSize(viewport, screen - SAFARI_CHROME)).toBeGreaterThanOrEqual(floor);
  });

  it('sizes the pentagon the same in both modes, on purpose', () => {
    // A helpers-only `--board-furniture` is the obvious fix and the wrong one:
    // the pentagon is already at its 205px floor on both of JQ-165's phones, so
    // reserving room for the rail can only take the tap surface down to that
    // floor and still overflow. One declaration, both modes; if a second ever
    // appears, the decision needs revisiting rather than extending.
    expect([...css.matchAll(/--board-furniture\s*:/g)]).toHaveLength(1);
  });
});

/**
 * The loadout sheet is a modal, so it is outside `--board-furniture` entirely —
 * which is the reason it is a modal (JQ-149). What it still owes a phone is that
 * two loadouts side by side do not become two unreadable columns.
 */
describe('the loadout sheet reads on a phone (JQ-149)', () => {
  it('stacks the two sides into one column at 360px', () => {
    expect(declaration('.loadout-sheet__sides', 'grid-template-columns', 360)).toBe(
      'minmax(0, 1fr)',
    );
  });

  it('keeps them side by side where there is room for both', () => {
    expect(declaration('.loadout-sheet__sides', 'grid-template-columns', 680)).toBe(
      'repeat(2, minmax(0, 1fr))',
    );
  });

  it('costs the board no height, because it never sits in the board', () => {
    // The seat card's loadout button is absolute against a card that already
    // exists. If it ever stops being, the pentagon pays — it is at its 205px
    // floor on both of JQ-165's phones — so the position is the load-bearing
    // half of that decision, not the styling.
    expect(declaration('.player__loadout', 'position', 390)).toBe('absolute');
    expect(declaration('.player__loadout-mark', 'position', 390)).toBe('absolute');
  });
});

describe('an unavailable move is not signalled by colour alone (JQ-98)', () => {
  it('draws the button with a dashed border', () => {
    // The same "this can't happen" language the faded opponent arrows use.
    expect(declaration('.move-btn--cooldown', 'border-style')).toBe('dashed');
  });

  it('dims the glyph only slightly, and leaves its colour to the button', () => {
    // While the moves were emoji this was grayscale(): a multicolour glyph had
    // its hue taken out. The drawn icons are one colour and inherit the
    // button's, so the non-colour signals (the dashed border above, and the
    // cooldown pill) carry the state, and the glyph only steps back — never as
    // far as the 28% opacity Phase 2 rejected for failing contrast.
    const opacity = Number(declaration('.move-btn--cooldown .move-btn__emoji', 'opacity'));
    expect(opacity).toBeGreaterThanOrEqual(0.7);
  });

  it('keeps the label readable rather than fading it out', () => {
    // Phase 2 rejected the old 28% opacity for failing contrast; the cooldown
    // state must stay legible, so its colour comes from the muted token.
    expect(declaration('.move-btn--cooldown', 'color')).toBe('var(--muted)');
  });
});


describe('hover never displaces a move button (regression)', () => {
  // The move buttons are positioned with translate(-50%, -50%). A hover rule
  // that sets `transform` without re-stating it flings the button half its own
  // size out from under the cursor, hover ends, it snaps back — jitter.
  it('excludes move buttons from the global hover lift', () => {
    expect(css).toMatch(/button:hover:not\(:disabled\):not\(\.move-btn\)/);
  });

  it('centres move buttons with `translate`, not `transform`', () => {
    // The two are separate properties that compose, so a hover or keyframe
    // touching `transform` can no longer drop the centring.
    expect(declaration('.move-btn', 'translate')).toBe('-50% -50%');
    const rule = /(?:^|\n)\.move-btn\s*\{([^}]*)\}/.exec(css);
    expect(rule?.[1]).not.toMatch(/(?:^|;)\s*transform:/);
  });

  it('grows the button on hover instead of moving it', () => {
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const compound = selector.replace(/:not\([^)]*\)/g, '').trim().split(/\s+/).pop() ?? '';
      if (!compound.startsWith('.move-btn') || !compound.includes(':hover')) continue;
      expect(body).not.toMatch(/(?:^|;)\s*transform:/);
    }
  });

  it('sizes a move in exactly one place', () => {
    // Two scale rules would compete on specificity, and hover's exclusion of
    // unavailable moves would make the playable one grow less. One owner only.
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      if (!selector.includes(':hover')) continue;
      expect(body).not.toMatch(/(?:^|;)\s*scale:/);
    }
  });

  it('grows whatever you are inspecting, playable or not', () => {
    // Size says "this is the move the centre is describing". Whether you can
    // play it is carried by the ring colour and the presence of Lock in.
    expect(declaration('.move-btn--preview,\n.move-btn--selected', 'scale')).toBe('1.08');
    const muted = /\.move-btn--cooldown\.move-btn--preview\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(muted).not.toMatch(/(?:^|;)\s*scale:/);
    expect(muted).toContain('border-color');
  });

  // :hover sticks after a tap on touch, leaving the control displaced.
  it('puts the hover affordances behind a hover media query', () => {
    const lift = css.indexOf('.move-btn:hover:not(:disabled):not([aria-disabled=');
    const guard = css.lastIndexOf('@media (hover: hover)', lift);
    expect(guard).toBeGreaterThan(-1);
    expect(css.slice(guard, lift)).not.toContain('}');
  });
});
