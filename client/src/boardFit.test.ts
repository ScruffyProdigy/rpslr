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

function boardWidth(viewport: number): number {
  return resolvePx(declaration('.move-board', 'width', viewport), boardInnerWidth(viewport));
}

function buttonSize(viewport: number): number {
  return resolvePx(declaration('.move-btn', 'width', viewport), boardWidth(viewport));
}

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
  topbar: 34, // .topbar — the wordmark h1 at 1.5rem
  ruleNote: 15.5, // .rule-note--board, one line at 0.78rem
  seatLabel: 13.5, // .player-label at 0.7rem
  seatName: 19.5, // .player-name at 1rem
  winPips: 18.4, // .win-pip is 1.15rem across
  roundLabel: 18, // .round-label at 1rem
  legend: 39.2, // .graph-legend, two lines at 0.72rem / 1.7
  pickerNote: 41.1, // .picker-note — a line plus its padding, border and dismiss button
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
  // The ledger reproduces what Chromium lays out: 813.2px at 390x844 and
  // 798.2px at 375x812, Lobby-seated, round 1, both transient lines showing.
  it.each([
    [390, 844],
    [375, 812],
  ])('round 1 fits %ix%i with both seats filled', (viewport, height) => {
    expect(pageHeight(viewport)).toBeLessThanOrEqual(height);
  });

  it('spends the space on the scoreboard, not the pentagon', () => {
    // JQ-108 sized the pentagon off the width it has. Height pressure must not
    // start eating it — the seat cards compress first, and the board never
    // gives up more than the width already asks of it.
    expect(boardWidth(390)).toBe(boardInnerWidth(390));
    expect(seatAvatar(390)).toBeLessThan(
      resolvePx(declaration('.player-avatar--lg', 'width'), 0),
    );
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
