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
import { FONT_BODY } from './tokens.js';

export const MAX_CARD_BYTES = 300_000;

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
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: CARD_WIDTH },
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: FONT_BODY },
  });
  return resvg.render().asPng();
}

/** PNG's IHDR: 8-byte signature, 4-byte length, 4-byte type, then w and h. */
export function pngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
