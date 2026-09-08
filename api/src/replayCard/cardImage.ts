/**
 * SVG in, PNG out. Fonts are loaded once at module init: resvg cannot read the
 * .woff2 files the client ships, so the same two families live here as TTF.
 *
 * They are passed as file paths, not buffers: resvg-js 2.6 takes `fontFiles`
 * and silently ignores any option it does not know, so a buffer-shaped call
 * loads nothing and renders the card in whatever face it finds lying around.
 */
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { CARD_WIDTH } from './cardLayout.js';
import { STORY_WIDTH } from './storyLayout.js';
import { FONT_BODY } from './tokens.js';

export const MAX_CARD_BYTES = 300_000;
/**
 * Instagram accepts far more, but a story the phone has to download before the
 * share sheet opens is a share sheet that feels broken. A card of flat colour,
 * two avatars and a QR lands well under this; the ceiling is asserted rather
 * than assumed.
 */
export const MAX_STORY_BYTES = 1_000_000;

const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../assets/fonts');

const fontFiles: string[] = readdirSync(FONT_DIR)
  .filter((name) => name.endsWith('.ttf'))
  .map((name) => join(FONT_DIR, name));

if (fontFiles.length === 0) {
  // Failing here beats shipping a card silently set in whatever the renderer
  // falls back to.
  throw new Error(`no TTF fonts found in ${FONT_DIR}`);
}

export function renderCardPng(svg: string): Buffer {
  return render(svg, CARD_WIDTH).asPng();
}

/** Same renderer, same fonts, 1080 wide. */
export function renderStoryPng(svg: string): Buffer {
  return render(svg, STORY_WIDTH).asPng();
}

/**
 * The story as raw RGBA, for the test that asks what actually landed on the
 * canvas. A box-based assertion only ever checks where we *said* something
 * would go; text that overruns its box is invisible to it, and was — the first
 * draft ran the short URL out past the gutter with every layout test passing.
 */
export function renderStoryPixels(svg: string): {
  pixels: Buffer;
  width: number;
  height: number;
} {
  const out = render(svg, STORY_WIDTH);
  return { pixels: out.pixels, width: out.width, height: out.height };
}

function render(svg: string, width: number) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: FONT_BODY },
  });
  return resvg.render();
}

/** PNG's IHDR: 8-byte signature, 4-byte length, 4-byte type, then w and h. */
export function pngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
