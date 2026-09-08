import { describe, expect, it } from 'vitest';
import { isInside, overlaps } from './cardLayout.js';
import type { CardModel } from './cardModel.js';
import { genericCardModel } from './cardModel.js';
import {
  SAFE_BOTTOM,
  SAFE_TOP,
  STORY_HEIGHT,
  STORY_WIDTH,
  storyContentBoxes,
  storyLayout,
} from './storyLayout.js';

function matchModel(overrides: Partial<CardModel> = {}): CardModel {
  return {
    kind: 'match',
    ref: 'ext-1',
    headline: 'Ana vs Ben · 3–1',
    ogTitle: 'Ana beat Ben 3–1 in RPSLR',
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

const CASES: Array<[string, CardModel]> = [
  ['a decided match', matchModel()],
  ['a match with no deciding round', matchModel({ showdown: null })],
  ['a match with no short code', matchModel({ shortCode: null })],
  ['the generic card', genericCardModel('nope')],
];

describe('storyLayout', () => {
  it('is exactly the size Instagram expects a story to be', () => {
    expect([STORY_WIDTH, STORY_HEIGHT]).toEqual([1080, 1920]);
    expect([SAFE_TOP, SAFE_BOTTOM]).toEqual([250, 1670]);
  });

  describe.each(CASES)('%s', (_name, model) => {
    const layout = storyLayout(model);
    const boxes = storyContentBoxes(layout);

    // The rule the whole layout exists to keep: Instagram's own chrome sits in
    // the top and bottom 250px, and anything we draw there is covered up.
    it('keeps every drawn box clear of Instagram’s chrome', () => {
      for (const box of boxes) {
        expect(box.y, JSON.stringify(box)).toBeGreaterThanOrEqual(SAFE_TOP);
        expect(box.y + box.height, JSON.stringify(box)).toBeLessThanOrEqual(SAFE_BOTTOM);
      }
    });

    it('keeps every drawn box inside the safe area on both axes', () => {
      for (const box of boxes) {
        expect(isInside(layout.safe, box), JSON.stringify(box)).toBe(true);
      }
    });

    // A name drawn over a disc is unreadable, and no safe-zone assertion would
    // ever notice it.
    it('draws nothing on top of anything else', () => {
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          expect(
            overlaps(boxes[i], boxes[j]),
            `${JSON.stringify(boxes[i])} over ${JSON.stringify(boxes[j])}`,
          ).toBe(false);
        }
      }
    });
  });

  it('puts the score between the two discs, not over them', () => {
    const layout = storyLayout(matchModel());
    const [left, right] = layout.avatars;
    expect(layout.score.x).toBeGreaterThan(left.x + left.width);
    expect(layout.score.x + layout.score.width).toBeLessThan(right.x);
  });

  it('drops the showdown boxes when there is no deciding round', () => {
    expect(storyLayout(matchModel({ showdown: null })).showdown).toBeNull();
  });

  it('drops the QR and the URL when there is no code to print', () => {
    expect(storyLayout(matchModel({ shortCode: null })).shortLink).toBeNull();
    expect(storyLayout(matchModel()).shortLink).not.toBeNull();
  });

  it('gives the generic card no players to draw', () => {
    const layout = storyLayout(genericCardModel('nope'));
    expect(layout.avatars).toEqual([]);
    expect(layout.names).toEqual([]);
  });
});
