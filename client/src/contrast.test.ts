import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The contrast the board actually renders, rather than the contrast its tokens
 * promise.
 *
 * Phase 6 audited both and only the second one was ever checkable: the palette
 * is in good shape — `--muted` on `--surface-2` is 7.16:1, every accent clears
 * AA — and every failure it found came from something composited on top of a
 * token. An `opacity` multiplier, a `stroke-opacity`, a `color-mix`. A token can
 * be correct while the pixels are not, and `boardFit.test.ts` had a test proving
 * it: `keeps the label readable rather than fading it out` asserted a cooldown
 * label comes from `--muted` and passed the whole time that label was rendering
 * at 2.48:1 under `.move-btn--dimmed` (JQ-192).
 *
 * So this file composites first and measures second. It reads `styles.css` from
 * disk for the same reason the other stylesheet tests do — vitest runs with
 * `css: false`, and jsdom has no cascade to ask.
 *
 * Thresholds are WCAG 2.2: 4.5:1 for body text (1.4.3), 3:1 for the parts of a
 * control that identify it and for graphics that carry meaning (1.4.11).
 */

const css = readFileSync(join(resolve(process.cwd(), 'src'), 'styles.css'), 'utf8');

const AA_TEXT = 4.5;
const AA_GRAPHIC = 3;

/* ---- reading the stylesheet ---------------------------------------------- */

/** The top-level `:root` block. The phone block has one too; it holds lengths. */
function rootBlock(): string {
  const start = css.indexOf(':root {');
  return css.slice(start, css.indexOf('\n}\n', start));
}

const TOKENS: ReadonlyMap<string, string> = new Map(
  [...rootBlock().matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
);

/**
 * One declaration from a top-level rule, later rules winning — the cascade for
 * the single- and double-class selectors read here. Media blocks are skipped on
 * purpose: none of the rules below are restated in one, and a test that silently
 * read the wrong layer would be worse than one that cannot see it at all.
 */
function declaration(selector: string, prop: string): string {
  const rule = new RegExp(`(?:^|\\n)${selector.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`, 'g');
  let value: string | null = null;
  for (const found of css.matchAll(rule)) {
    const body = found[1].replace(/\/\*[\s\S]*?\*\//g, '');
    const decl = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(body);
    if (decl) value = decl[1].trim();
  }
  if (value === null) throw new Error(`styles.css: ${selector} does not declare ${prop}`);
  return value;
}

/** Whether a top-level rule declares `prop` at all. */
function declares(selector: string, prop: string): boolean {
  try {
    declaration(selector, prop);
    return true;
  } catch {
    return false;
  }
}

/* ---- colour --------------------------------------------------------------- */

type Rgb = readonly [number, number, number];

/** Split on top-level commas, so a nested `color-mix` survives. */
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

/**
 * A CSS colour as sRGB. Handles the three forms the stylesheet uses: a hex, a
 * `var()` naming one, and `color-mix(in srgb, A p%, B)`. `transparent` is not
 * accepted — a colour that is not there cannot be measured, and every call site
 * here wants the thing underneath instead.
 */
function colour(expr: string, over?: Rgb): Rgb {
  const v = expr.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const ref = /^var\((--[\w-]+)\)$/.exec(v);
  if (ref) {
    const token = TOKENS.get(ref[1]);
    if (!token) throw new Error(`styles.css: :root has no ${ref[1]}`);
    return colour(token, over);
  }
  const mix = /^color-mix\(in srgb,(.*)\)$/s.exec(v);
  if (mix) {
    const [first, second] = args(mix[1]);
    const pct = /^(.*)\s+([\d.]+)%$/s.exec(first);
    if (!pct) throw new Error(`cannot read a percentage from: ${first}`);
    const share = Number(pct[2]) / 100;
    // `transparent` as the other half is an alpha, not a hue: what shows is the
    // named colour at `share` over whatever it is drawn on.
    const base = second === 'transparent' ? over : colour(second, over);
    if (!base) throw new Error(`${v} needs a backdrop to resolve against`);
    return composite(colour(pct[1], over), base, share);
  }
  throw new Error(`cannot resolve colour: ${expr}`);
}

/** `fg` drawn at `alpha` over `bg`. */
function composite(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return [0, 1, 2].map((i) => alpha * fg[i] + (1 - alpha) * bg[i]) as unknown as Rgb;
}

function relativeLuminance([r, g, b]: Rgb): number {
  const lin = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG contrast ratio, rounded the way the audit reports it. */
function ratio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

const token = (name: string) => colour(`var(${name})`);

/* ---- the palette, as a baseline ------------------------------------------- */

describe('the token palette clears AA on its own (Phase 6 baseline)', () => {
  // Recorded so the next audit starts here rather than re-deriving it. These
  // passed before JQ-192 and JQ-193 and are expected to keep passing: the
  // failures those tickets fixed were never in this layer.
  it.each([
    ['--muted on --surface-2 is 7.16:1', '--muted', '--surface-2', 7.16, AA_TEXT],
    ['--muted-2 on --card is 4.59:1', '--muted-2', '--card', 4.59, AA_TEXT],
    ['--text on --card is 13.72:1', '--text', '--card', 13.72, AA_TEXT],
    ['--you on --card is 5.47:1', '--you', '--card', 5.47, AA_GRAPHIC],
    ['--opp on --card is 8.24:1', '--opp', '--card', 8.24, AA_GRAPHIC],
    ['--win on --card is 8.75:1', '--win', '--card', 8.75, AA_GRAPHIC],
    ['--warn on --card is 10.31:1', '--warn', '--card', 10.31, AA_GRAPHIC],
  ])('%s', (_what, fg, bg, measured, floor) => {
    expect(ratio(token(fg), token(bg))).toBeCloseTo(measured as number, 1);
    expect(ratio(token(fg), token(bg))).toBeGreaterThanOrEqual(floor as number);
  });
});

/* ---- 1.4.3: text ---------------------------------------------------------- */

describe('text on the board clears 4.5:1 (JQ-192)', () => {
  const CARD = token('--card');
  const OPEN = colour(declaration('.move-btn', 'background'));
  const COOLDOWN = colour(declaration('.move-btn--cooldown', 'background'));

  it('does not fade a locked-in move, because fading is what broke it', () => {
    // The whole ticket in one assertion. `opacity` on the button is the only
    // thing that can put the label below 4.5:1 without any token changing, and
    // the two measurements below are only meaningful while it is absent.
    expect(declares('.move-btn--dimmed', 'opacity')).toBe(false);
  });

  it('keeps a move label readable once you have locked in', () => {
    // Was 3.86:1 — `--text` and `--surface-3` composited together at 0.45 over
    // the board. This is the board's state for most of every round.
    expect(ratio(colour(declaration('.move-btn--dimmed', 'color')), OPEN)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });

  it('keeps a locked-in move that is also on cooldown readable', () => {
    // Was 2.48:1, the worst text on the board: a label already stepped to
    // `--muted`, then faded again by the dim on top of it.
    expect(
      ratio(colour(declaration('.move-btn--dimmed', 'color')), COOLDOWN),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('keeps the turn count on a dimmed move readable', () => {
    // The pill is the only place the number of turns left is written down.
    expect(
      ratio(
        colour(declaration('.move-btn--dimmed .cooldown-pill', 'color')),
        colour(declaration('.move-btn--dimmed .cooldown-pill', 'background')),
      ),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('leaves a move label readable before anyone locks in', () => {
    expect(ratio(colour(declaration('.move-btn', 'color')), OPEN)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(
      ratio(colour(declaration('.move-btn--cooldown', 'color')), COOLDOWN),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('keeps the board card itself the backdrop these are measured against', () => {
    // Every number above assumes the buttons sit on `--card`. If the board ever
    // grows its own background, they are all measuring the wrong thing.
    expect(colour(declaration('.board', 'background'))).toEqual(CARD);
  });
});
