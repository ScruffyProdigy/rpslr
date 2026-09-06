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

/** The value of one declaration in one rule, e.g. `.move-btn` → `width`. */
function declaration(selector: string, prop: string): string {
  const rule = new RegExp(`(?:^|\\n)${selector.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`).exec(css);
  if (!rule) throw new Error(`styles.css has no rule for ${selector}`);
  // Strip comments first, or a commented declaration reads as missing.
  const body = rule[1].replace(/\/\*[\s\S]*?\*\//g, '');
  const found = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(body);
  if (!found) throw new Error(`${selector} no longer declares ${prop}`);
  return found[1].trim();
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
  const num = /^(-?[\d.]+)(px|%|cqw)$/.exec(v);
  if (!num) throw new Error(`cannot resolve length: ${value}`);
  const n = Number(num[1]);
  return num[2] === 'px' ? n : (n / 100) * container;
}

/** Board width available inside the app's horizontal padding. */
function contentWidth(viewport: number): number {
  const pad = declaration('.app', 'padding-left');
  if (!pad.includes('16px')) throw new Error(`.app padding-left changed: ${pad}`);
  return viewport - 32;
}

function boardWidth(viewport: number): number {
  return resolvePx(declaration('.move-board', 'width'), contentWidth(viewport));
}

function buttonSize(viewport: number): number {
  return resolvePx(declaration('.move-btn', 'width'), boardWidth(viewport));
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
    expect(boardWidth(viewport)).toBeLessThanOrEqual(contentWidth(viewport));
  });

  it('stops growing once there is room, so the board never dominates a desktop', () => {
    expect(boardWidth(1400)).toBe(380);
  });
});


describe('an unavailable move is not signalled by colour alone (JQ-98)', () => {
  it('draws the button with a dashed border', () => {
    // The same "this can't happen" language the faded opponent arrows use.
    expect(declaration('.move-btn--cooldown', 'border-style')).toBe('dashed');
  });

  it('takes the colour out of the glyph rather than only dimming it', () => {
    const filter = declaration('.move-btn--cooldown .move-btn__emoji', 'filter');
    expect(filter).toContain('grayscale');
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

  it('grows whatever you are inspecting, playable or not', () => {
    // Size says "this is the move the centre is describing". Whether you can
    // play it is carried by the ring colour and the presence of Lock in.
    expect(declaration('.move-btn--preview,\n.move-btn--selected', 'scale')).toBe('1.07');
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
