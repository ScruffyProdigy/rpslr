import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { MAX_STORY_BYTES, pngSize, renderStoryPixels, renderStoryPng } from './cardImage.js';
import type { CardModel } from './cardModel.js';
import { genericCardModel } from './cardModel.js';
import { SAFE_BOTTOM, SAFE_GUTTER, SAFE_TOP, STORY_HEIGHT, STORY_WIDTH, storyLayout } from './storyLayout.js';
import { shortLinkUrl, storySvg } from './storySvg.js';

const ORIGIN = 'https://rpsls-duel.win';

function matchModel(overrides: Partial<CardModel> = {}): CardModel {
  return {
    kind: 'match',
    ref: 'ext-1',
    headline: 'Ana wins 3–1',
    ogTitle: 'Ana wins 3–1!',
    ogDescription: '…',
    cacheable: true,
    shortCode: 'RPS-ABCD',
    showdown: { round: 4, winnerMove: 'robot', loserMove: 'rock', caption: 'Robot vaporizes Rock' },
    players: [
      { seatKey: '1', name: 'Ana', score: 3, role: 'you', avatarUrl: null, avatarDataUri: null, initial: 'A', winner: true },
      { seatKey: '2', name: 'Ben', score: 1, role: 'opp', avatarUrl: null, avatarDataUri: null, initial: 'B', winner: false },
    ],
    ...overrides,
  };
}

describe('storySvg', () => {
  it('says the score, the names and the headline', () => {
    const svg = storySvg(matchModel(), { origin: ORIGIN });
    expect(svg).toContain('Ana wins 3–1');
    expect(svg).toContain('>Ana<');
    expect(svg).toContain('>Ben<');
    expect(svg).toContain('3–1');
  });

  it('draws the deciding round as two icons, a verb and the phrase', () => {
    const svg = storySvg(matchModel(), { origin: ORIGIN });
    expect(svg).toContain('>vaporizes<');
    expect(svg).toContain('Round 4 · Robot vaporizes Rock');
    // Both silhouettes are present, tinted by who played them.
    expect(svg).toContain('#6c8cff'); // --you, the winner
    expect(svg).toContain('#f5a524'); // --opp, the loser
  });

  it('says nothing about a showdown when no round decided the match', () => {
    const svg = storySvg(matchModel({ showdown: null }), { origin: ORIGIN });
    expect(svg).not.toContain('Round');
    expect(svg).not.toContain('vaporizes');
  });

  it('prints the short link and encodes the same one in the QR', () => {
    const svg = storySvg(matchModel(), { origin: ORIGIN });
    // Printed without the scheme — it is a URL to type, not one to click.
    expect(svg).toContain('rpsls-duel.win/r/RPS-ABCD');
    expect(svg).not.toContain('>https://rpsls-duel.win/r/RPS-ABCD<');
    expect(shortLinkUrl(ORIGIN, 'RPS-ABCD')).toBe('https://rpsls-duel.win/r/RPS-ABCD');
    // A QR is drawn: a path far longer than anything else in the template.
    expect(svg).toMatch(/<path d="M[\d.]+ [\d.]+h[\d.]+v[\d.]+h-[\d.]+z/);
  });

  it('drops the link block when the match has no code', () => {
    const svg = storySvg(matchModel({ shortCode: null }), { origin: ORIGIN });
    expect(svg).not.toContain('/r/');
  });

  // The card carries player-supplied names. An unescaped one is a broken image,
  // and the image is the whole feature.
  it('escapes a name that would otherwise break the document', () => {
    const model = matchModel();
    model.players[0].name = 'A<b>&"x"';
    const svg = storySvg(model, { origin: ORIGIN });
    expect(svg).toContain('A&lt;b&gt;&amp;&quot;x&quot;');
    expect(svg).not.toContain('<b>&"x"');
  });

  it('answers with a card even when there is no match', () => {
    const svg = storySvg(genericCardModel('nope'), { origin: ORIGIN });
    expect(svg).toContain('RPSLR on JoinQuest');
    expect(svg).toContain(`width="${STORY_WIDTH}"`);
  });
});

describe('the rendered story', () => {
  it('is exactly the size Instagram wants, and small enough to hand over', () => {
    const png = renderStoryPng(storySvg(matchModel(), { origin: ORIGIN }));
    expect(pngSize(png)).toEqual({ width: STORY_WIDTH, height: STORY_HEIGHT });
    expect(png.byteLength).toBeLessThanOrEqual(MAX_STORY_BYTES);
  });

  it('renders the generic card at story size too', () => {
    const png = renderStoryPng(storySvg(genericCardModel('nope'), { origin: ORIGIN }));
    expect(pngSize(png)).toEqual({ width: STORY_WIDTH, height: STORY_HEIGHT });
    expect(png.byteLength).toBeLessThanOrEqual(MAX_STORY_BYTES);
  });

  it('renders every move without the rasteriser choking on the art', () => {
    for (const move of ['rock', 'paper', 'scissors', 'lizard', 'robot'] as const) {
      const model = matchModel({
        showdown: { round: 1, winnerMove: move, loserMove: move, caption: `${move} vs ${move}` },
      });
      expect(pngSize(renderStoryPng(storySvg(model, { origin: ORIGIN }))).height).toBe(STORY_HEIGHT);
    }
  });
});

/**
 * What the box tests cannot see.
 *
 * `storyLayout.test.ts` checks where the template says it will draw. This
 * checks where the rasteriser actually put ink — which is the only way to catch
 * text that overruns the box it was given. It caught exactly that: the short
 * URL, set beside the QR in 540px of space, ran out past the right gutter while
 * every box assertion passed.
 *
 * The ground is a vertical gradient, so a row's own leftmost pixel is that
 * row's background. Anything outside the safe area that differs from it is ink
 * where Instagram is about to draw its own chrome.
 */
function inkOutsideSafeArea(svg: string): Array<{ x: number; y: number }> {
  const { pixels, width, height } = renderStoryPixels(svg);
  const at = (x: number, y: number) => (y * width + x) * 4;
  const differs = (x: number, y: number) => {
    const a = at(x, y);
    const b = at(0, y);
    // Antialiasing against the gradient leaves a pixel or two of drift; only a
    // real mark moves a channel further than this.
    return (
      Math.abs(pixels[a] - pixels[b]) > 8 ||
      Math.abs(pixels[a + 1] - pixels[b + 1]) > 8 ||
      Math.abs(pixels[a + 2] - pixels[b + 2]) > 8
    );
  };

  const found: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < height; y += 1) {
    const reservedRow = y < SAFE_TOP || y >= SAFE_BOTTOM;
    for (let x = 1; x < width; x += 1) {
      const reserved = reservedRow || x < SAFE_GUTTER || x >= width - SAFE_GUTTER;
      if (reserved && differs(x, y)) found.push({ x, y });
    }
  }
  return found;
}

describe('what actually lands on the canvas', () => {
  it('puts no ink where Instagram draws its own chrome', () => {
    const ink = inkOutsideSafeArea(storySvg(matchModel(), { origin: ORIGIN }));
    expect(ink.slice(0, 5), `${ink.length} stray pixels`).toEqual([]);
  });

  it('keeps a long name and a long code inside the safe area too', () => {
    // The widest realistic card: two long display names and a full-length code.
    const model = matchModel({ shortCode: 'RPS-WXYZ' });
    model.players[0].name = 'Wolfgang-Amadeus';
    model.players[1].name = 'Bartholomew-Xu';
    const ink = inkOutsideSafeArea(storySvg(model, { origin: ORIGIN }));
    expect(ink.slice(0, 5), `${ink.length} stray pixels`).toEqual([]);
  });

  it('keeps the generic card inside it as well', () => {
    const ink = inkOutsideSafeArea(storySvg(genericCardModel('nope'), { origin: ORIGIN }));
    expect(ink.slice(0, 5), `${ink.length} stray pixels`).toEqual([]);
  });
});

describe('the QR on the finished card', () => {
  /**
   * qrSvg.test.ts proves the symbol scans on its own. This proves it survives
   * being placed: on its rounded plate, at the size the layout gives it, with
   * the rest of the card drawn around it. That is the artefact a phone is
   * actually pointed at.
   */
  it('reads back as the short link the card also prints', () => {
    const model = matchModel({ shortCode: 'RPS-K7M2' });
    const { pixels, width } = renderStoryPixels(storySvg(model, { origin: ORIGIN }));
    const box = storyLayout(model).shortLink!.qr;

    // Cropped to the plate: jsQR scans a 1080×1920 canvas happily enough, but
    // there is no reason to make it hunt.
    const side = box.width;
    const crop = new Uint8ClampedArray(side * side * 4);
    for (let y = 0; y < side; y += 1) {
      const from = ((box.y + y) * width + box.x) * 4;
      crop.set(pixels.subarray(from, from + side * 4), y * side * 4);
    }

    expect(jsQR(crop, side, side)?.data).toBe('https://rpsls-duel.win/r/RPS-K7M2');
  });
});
