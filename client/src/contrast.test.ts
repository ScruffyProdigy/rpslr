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

  it('steps the cooldown glyph back without taking it under its own floor', () => {
    // JQ-192 asked for this to be re-measured once the dim above stopped
    // compounding on top of it. It is unchanged — 0.75 over --surface-2, 4.53:1
    // — and it now reads the same whether or not the move is also dimmed,
    // because `.move-btn--dimmed` no longer multiplies anything.
    //
    // Read against 3:1 rather than 4.5:1, which is the correction: the glyph is
    // a graphic under 1.4.11 with the move's name written directly beneath it,
    // not text. The ticket called 4.55:1 "no margin at all" while measuring it
    // against the threshold for text; against its own it has half as much
    // headroom again.
    const glyph = composite(
      colour(declaration('.move-btn--cooldown', 'color')),
      COOLDOWN,
      Number(declaration('.move-btn--cooldown .move-btn__emoji', 'opacity')),
    );
    expect(ratio(glyph, COOLDOWN)).toBeGreaterThanOrEqual(AA_GRAPHIC);
    // And nothing re-fades it once the round is locked: `boardFit.test.ts`
    // holds the 0.75 itself, this holds that it stays the only multiplier.
    expect(css).not.toMatch(/\.move-btn--dimmed[^{]*\.move-btn__emoji\s*\{[^}]*opacity/);
  });

  it('keeps the board card itself the backdrop these are measured against', () => {
    // Every number above assumes the buttons sit on `--card`. If the board ever
    // grows its own background, they are all measuring the wrong thing.
    expect(colour(declaration('.board', 'background'))).toEqual(CARD);
  });
});

/* ---- 1.4.11: non-text ----------------------------------------------------- */

describe("the board's graphics clear 3:1 (JQ-193)", () => {
  const CARD = token('--card');
  /** The seat card, which is what the win pips are drawn on. */
  const SEAT = colour(declaration('.player', 'background'));

  /** A stroke at its `stroke-opacity`, composited onto the board. */
  function stroke(selector: string, backdrop = CARD) {
    return composite(
      colour(declaration(selector, 'stroke')),
      backdrop,
      Number(declaration(selector, 'stroke-opacity')),
    );
  }

  /** A rule's border colour, whether it is declared long-hand or in the shorthand. */
  function borderColour(selector: string, backdrop: Rgb): Rgb {
    const value = declares(selector, 'border-color')
      ? declaration(selector, 'border-color')
      : declaration(selector, 'border').replace(/^[\d.]+px\s+\w+\s+/, '');
    return colour(value, backdrop);
  }

  it.each([
    // Fixed by this ticket, with what it measured before for the next reader.
    ['the move button, the tap target itself — was 1.73:1', '.move-btn', CARD],
    ['a move on cooldown, still focusable — was 1.48:1', '.move-btn--cooldown', CARD],
    ['an unfilled win pip, the only mark a round-not-won gets — was 1.91:1', '.win-pip.empty', SEAT],
    // Already passing. Recorded so the next audit starts from a baseline
    // instead of deriving one again.
    ['the move you are inspecting', '.move-btn--preview', CARD],
    ['one you cannot play, inspected', '.move-btn--cooldown.move-btn--preview', CARD],
    ['the move you locked in', '.move-btn--selected', CARD],
    ['a move your preview beats', '.move-btn--target', CARD],
    ['a move the floor puts on offer anyway', '.move-btn--forced', CARD],
    ['a filled win pip', '.win-pip.filled', SEAT],
  ])('%s', (_what, selector, backdrop) => {
    const b = backdrop as Rgb;
    expect(ratio(borderColour(selector as string, b), b)).toBeGreaterThanOrEqual(AA_GRAPHIC);
  });

  it('draws the beats arrows visibly enough to be the graph', () => {
    // Was 2.96:1 at `stroke-opacity: 0.7`. A near miss is still a miss, and the
    // arrows are the only thing on the pentagon that says what beats what.
    expect(ratio(stroke('.beat-arrow'), CARD)).toBeGreaterThanOrEqual(AA_GRAPHIC);
  });

  it('starts the winning edge’s flare from the resting weight it leaves', () => {
    // `arrow-strike` opens at the values `.beat-arrow` rests at, so raising one
    // without the other makes the animation jump on its first frame.
    const keyframe = /@keyframes arrow-strike \{\s*0% \{([^}]*)\}/.exec(css)?.[1] ?? '';
    const opening = /stroke-opacity:\s*([\d.]+)/.exec(keyframe)?.[1];
    expect(Number(opening)).toBe(Number(declaration('.beat-arrow', 'stroke-opacity')));
  });

  it('leaves a dead opponent edge faint, and says why in the stylesheet', () => {
    // The recorded exception. 1.89:1, held on purpose: the faintness *is* the
    // information — this edge is the one not in play — so 1.4.11's essential-
    // presentation carve-out applies. What the test holds is the thing that
    // would actually break it: the non-colour cue that carries the same fact.
    expect(ratio(stroke('.beat-arrow--opp-off'), CARD)).toBeLessThan(AA_GRAPHIC);
    expect(declaration('.beat-arrow--opp-off', 'stroke-dasharray')).toBe('5 5');
    const rule = /\.beat-arrow--opp-off[\s\S]{0,400}?\{/.exec(css)?.index ?? 0;
    expect(css.slice(Math.max(0, rule - 900), rule)).toMatch(/essential/);
  });

  it('keeps a control’s outline below a border carrying state', () => {
    // --line-control is not a step on the seam ladder — `designSystem.test.ts`
    // holds that one's order — but it still has to sit under --line-4, or a
    // resting move button shouts as loudly as a hovered or ready one.
    const light = (name: string) => relativeLuminance(token(name));
    expect(light('--line-control')).toBeGreaterThan(light('--line-3'));
    expect(light('--line-control')).toBeLessThan(light('--line-4'));
  });
});
