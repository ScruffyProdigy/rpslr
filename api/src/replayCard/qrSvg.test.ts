import { Resvg } from '@resvg/resvg-js';
import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { QUIET_MODULES, qrArt } from './qrSvg.js';

/**
 * Rasterise a QR at `size` and read it back with a real decoder.
 *
 * The point of a QR on a card is that a phone can scan it, and nothing short of
 * decoding actually checks that. resvg is already a dependency and gives raw
 * RGBA, so the round trip costs one devDependency and catches the whole class of
 * bugs — flipped axes, a missing quiet zone, modules too small to resolve — that
 * a structural assertion would wave through.
 */
function decode(text: string, size: number): string | null {
  const art = qrArt(text, size);
  if (!art) return null;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" fill="#ffffff"/>
    <path d="${art.path}" fill="#000000"/>
  </svg>`;
  const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render();
  const result = jsQR(
    Uint8ClampedArray.from(rendered.pixels),
    rendered.width,
    rendered.height,
  );
  return result?.data ?? null;
}

describe('qrArt', () => {
  it('produces a code a scanner reads back as the URL', () => {
    const url = 'https://rpsls-duel.win/r/RPS-K7M2';
    expect(decode(url, 260)).toBe(url);
  });

  it('still scans at the size the card actually draws it', () => {
    // The card's QR box. If this ever shrinks below what a decoder can resolve,
    // this is where it should fail — not on someone's phone.
    const url = 'https://rpsls-duel.win/r/RPS-ABCD';
    expect(decode(url, 260)).toBe(url);
  });

  it('scans after the symbol is scaled up, as a story is when it is viewed', () => {
    const url = 'https://rpsls-duel.win/r/RPS-9XYZ';
    expect(decode(url, 520)).toBe(url);
  });

  it('leaves a quiet zone the background can show through', () => {
    const art = qrArt('https://rpsls-duel.win/r/RPS-K7M2', 260);
    expect(art).not.toBeNull();
    const margin = QUIET_MODULES * art!.moduleSize;
    // No drawn module starts inside the margin on either axis.
    const coords = [...art!.path.matchAll(/M(-?[\d.]+) (-?[\d.]+)/g)];
    expect(coords.length).toBeGreaterThan(0);
    for (const [, x, y] of coords) {
      expect(Number(x)).toBeGreaterThanOrEqual(margin - 0.01);
      expect(Number(y)).toBeGreaterThanOrEqual(margin - 0.01);
    }
  });

  it('fills the box it was given', () => {
    const art = qrArt('https://rpsls-duel.win/r/RPS-K7M2', 260)!;
    expect((art.moduleCount + QUIET_MODULES * 2) * art.moduleSize).toBeCloseTo(260, 5);
  });

  it('declines rather than throws when there is nothing to encode', () => {
    expect(qrArt('', 260)).toBeNull();
    expect(qrArt('https://rpsls-duel.win/r/RPS-K7M2', 0)).toBeNull();
  });
});
