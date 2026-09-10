import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * One rule holds every `prefers-reduced-motion` block in the stylesheet:
 * motion may be removed, meaning may not.
 *
 * It is easy to break by accident, because the natural way to honour the
 * preference is `animation: none` — and that is right for a flourish and wrong
 * for the one animation that was carrying the information. The winning pip was
 * exactly that case: its pulse was the only signal of *which* pip had filled,
 * and reduced motion deleted the signal instead of degrading it (JQ-157).
 *
 * These read the stylesheet rather than the DOM: jsdom has no cascade, so
 * nothing else in the suite can see a media query at all.
 */

const css = readFileSync(join(resolve(process.cwd(), 'src'), 'styles.css'), 'utf8');

/** The body of every `@media (prefers-reduced-motion: reduce)` block. */
function reducedMotionBodies(): string[] {
  const open = /@media \(prefers-reduced-motion: reduce\) \{/g;
  const bodies: string[] = [];
  while (open.exec(css) !== null) {
    let depth = 1;
    let i = open.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    bodies.push(css.slice(open.lastIndex, i - 1));
  }
  return bodies;
}

/** Every rule in `source`, as selectors paired with their declarations. */
function rules(source: string): Array<{ selectors: string[]; declarations: string }> {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((r) => ({
    selectors: r[1]
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    declarations: r[2],
  }));
}

/** A selector's unconditional rule — the one at column 0, outside any block. */
function baseRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

const reduced = rules(reducedMotionBodies().join('\n'));

describe('reduced motion removes motion, not meaning (JQ-157)', () => {
  it('finds the blocks it is auditing', () => {
    expect(reducedMotionBodies().length).toBeGreaterThan(0);
    expect(reduced.length).toBeGreaterThan(0);
  });

  it('keeps the pip that just filled distinguishable without its pulse', () => {
    // The score reads the same before and after the pip fills, so the pulse
    // was the whole signal. Its stand-in has to be shape, not hue: the pips
    // are already told apart by colour, and that is the axis in shortest
    // supply here.
    const pip = reduced.filter((r) => r.selectors.includes('.win-pip--pulse'));
    expect(pip.some((r) => /animation:\s*none/.test(r.declarations))).toBe(true);
    expect(pip.some((r) => /outline|box-shadow/.test(r.declarations))).toBe(true);
  });

  it('never silences an animation whose element the base rule leaves invisible', () => {
    // The reveal's entrances start at `opacity: 0` and hold it with `both`.
    // Killing them is only safe while the base rule does not hide the element
    // too — otherwise reduced motion means the content never appears at all.
    const silenced = reduced
      .filter((r) => /animation(-name)?:\s*none/.test(r.declarations))
      .flatMap((r) => r.selectors);
    expect(silenced.length).toBeGreaterThan(0);
    expect(silenced.filter((sel) => /opacity:\s*0\s*[;}]/.test(baseRule(sel)))).toEqual([]);
  });

  it('hides nothing but the one piece of pure decoration', () => {
    // The impact ring is a flourish behind an aria-hidden span: with no motion
    // there is nothing left for it to show. Anything else disappearing here
    // would be information going missing.
    const hidden = reduced
      .filter((r) => /display:\s*none/.test(r.declarations))
      .flatMap((r) => r.selectors);
    expect(hidden).toEqual(['.reveal-card__impact']);
  });

  it('leaves the loadout sheet with no motion to have to remove (JQ-149)', () => {
    // The reveal is time-bounded rather than animated: it appears, it holds, it
    // goes. Nothing in it moves, so there is nothing here for a reduced-motion
    // block to strip — and this is what says so, rather than a comment, because
    // the failure mode is a flourish added later with no counterpart. The
    // sibling assertions above only audit blocks that already exist.
    const sheet = [...css.matchAll(/(^|\n)(\.loadout-[^{,]*)\s*\{([^}]*)\}/g)];
    // A renamed block would make the audit below pass by finding nothing.
    expect(sheet.length).toBeGreaterThan(5);
    const animated = sheet.filter((r) => /animation|transition/.test(r[3]));
    expect(animated.map((r) => r[2].trim())).toEqual([]);
  });

  it('keeps the round-winning edge lit without its strike animation', () => {
    // `arrow-strike` is the flare; the weight and the halo that separate this
    // edge from the other nine belong to the rule itself, so they survive.
    const base = baseRule('.beat-arrow--won');
    expect(base).toMatch(/stroke-width:\s*4\.5/);
    expect(base).toMatch(/stroke-opacity:\s*1/);
    expect(base).toMatch(/drop-shadow/);
  });
});
