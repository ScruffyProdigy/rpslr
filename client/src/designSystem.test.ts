import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Phase 5 established two things that nothing else can hold: every colour is a
 * named token, and every glyph on the board is drawn rather than borrowed from
 * the OS. Both drift silently — the path of least resistance for the next
 * person is to type a hex into a new rule, or drop an emoji into new JSX, and
 * neither breaks anything that currently fails.
 *
 * Both regressions have already happened once. The icon set replaced the five
 * moves and left ⏳, ✓ and 🏆 behind, sitting on the same buttons.
 */

const SRC = resolve(process.cwd(), 'src');
const css = readFileSync(join(SRC, 'styles.css'), 'utf8');

/** Everything after the `:root` block — where no raw colour belongs. */
function stylesheetBelowRoot(): string {
  const start = css.indexOf(':root {');
  const end = css.indexOf('\n}\n', start) + 3;
  return css.slice(0, start) + css.slice(end);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(path) || /\.test\.tsx?$/.test(path)) return [];
    return [path];
  });
}

/** Comments discuss the emoji we removed; only shipped code counts. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/*
 * Pictographs, dingbats (✓ is U+2713) and the clock/media block (⏳ is U+23F3).
 * Deliberately narrow: ·, —, ×, → and the other typographic marks the copy
 * uses are not emoji and must keep working. U+FE0F is left out on purpose —
 * it only ever trails a codepoint one of these ranges already catches, and
 * inside a character class it combines with its neighbour.
 */
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{23E9}-\u{23FA}]/gu;

describe('design system invariants (JQ-97)', () => {
  it('names every colour — no raw hex outside :root', () => {
    const stray = [...stylesheetBelowRoot().matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
    expect(stray).toEqual([]);
  });

  it('defines the surface and line ladders in elevation order', () => {
    // The ladders are only useful if "one step up" means one step lighter.
    for (const prefix of ['--surface-', '--line-']) {
      const steps = [...css.matchAll(new RegExp(`${prefix}(\\d+): (#[0-9a-f]{6})`, 'g'))].map(
        (m) => [Number(m[1]), m[2]] as const,
      );
      expect(steps.length).toBeGreaterThan(2);
      const luminance = ([, hex]: readonly [number, string]) =>
        parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
      const ordered = [...steps].sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < ordered.length; i++) {
        expect(luminance(ordered[i])).toBeGreaterThan(luminance(ordered[i - 1]));
      }
    }
  });

  it('draws every glyph — no emoji in shipped components', () => {
    const offenders = sourceFiles(SRC)
      .map((path) => [path, [...new Set(stripComments(readFileSync(path, 'utf8')).match(EMOJI) ?? [])]] as const)
      .filter(([, found]) => found.length > 0)
      .map(([path, found]) => `${path.replace(`${SRC}/`, '')}: ${found.join(' ')}`);
    expect(offenders).toEqual([]);
  });
});
