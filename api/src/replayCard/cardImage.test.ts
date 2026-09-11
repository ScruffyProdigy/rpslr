import { describe, expect, it } from 'vitest';
import { MAX_CARD_BYTES, pngSize, renderCardPng } from './cardImage.js';
import { cardSvg } from './cardSvg.js';
import { genericCardModel, type CardModel } from './cardModel.js';

/** A 1×1 red PNG, standing in for a Lobby avatar. */
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const match: CardModel = {
  kind: 'match',
  ref: 'ext-1',
  headline: 'Ana vs Ben · 3–1',
  ogTitle: 'Ana beat Ben 3–1 in RPSLR',
  ogDescription: '1 Rock over Scissors',
  cacheable: true,
  players: [
    { seatKey: '1', name: 'Ana', score: 3, role: 'you', avatarUrl: null, avatarDataUri: PIXEL, initial: 'A', winner: true },
    { seatKey: '2', name: 'Ben', score: 1, role: 'opp', avatarUrl: null, avatarDataUri: PIXEL, initial: 'B', winner: false },
  ],
  showdown: null,
  shortCode: null,
};

describe('renderCardPng', () => {
  it('renders exactly 1200×630', () => {
    expect(pngSize(renderCardPng(cardSvg(match)))).toEqual({ width: 1200, height: 630 });
  });

  it("stays under WhatsApp's 300 KB limit with two avatars embedded", () => {
    expect(renderCardPng(cardSvg(match)).byteLength).toBeLessThanOrEqual(MAX_CARD_BYTES);
  });

  it('renders the generic card too', () => {
    expect(pngSize(renderCardPng(cardSvg(genericCardModel('missing'))))).toEqual({
      width: 1200,
      height: 630,
    });
  });

  it('uses the fonts it was given — two families do not render alike', () => {
    // resvg silently ignores font options it does not recognise. When that
    // happened, every family rendered byte-identically and nothing else caught it.
    const archivo = renderCardPng(cardSvg(match));
    const atkinson = renderCardPng(
      cardSvg(match).replace(/font-family="Archivo"/g, 'font-family="Atkinson Hyperlegible"'),
    );
    expect(archivo.equals(atkinson)).toBe(false);
  });

  it('actually draws the text — a bold headline differs from a light one', () => {
    const bold = renderCardPng(cardSvg(match));
    const light = renderCardPng(cardSvg(match).replace(/font-weight="700"/g, 'font-weight="400"'));
    expect(bold.equals(light)).toBe(false);
  });
});
