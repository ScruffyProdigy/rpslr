import { describe, expect, it } from 'vitest';
import { genericCardModel } from './cardModel.js';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  SAFE_SIZE,
  SAFE_X,
  cardLayout,
  contentBoxes,
  isInside,
  overlaps,
} from './cardLayout.js';

const generic = genericCardModel('ref');

function twoPlayers() {
  return [
    { seatKey: '1', name: 'Ana', score: 3, role: 'you' as const, avatarUrl: null, avatarDataUri: null, initial: 'A', winner: true },
    { seatKey: '2', name: 'Ben', score: 1, role: 'opp' as const, avatarUrl: null, avatarDataUri: null, initial: 'B', winner: false },
  ];
}

describe('cardLayout', () => {
  it('describes the centre square a square crop keeps', () => {
    const { safe } = cardLayout(generic);
    expect(safe).toEqual({ x: SAFE_X, y: 0, width: SAFE_SIZE, height: SAFE_SIZE });
    expect(SAFE_X * 2 + SAFE_SIZE).toBe(CARD_WIDTH);
    expect(SAFE_SIZE).toBe(CARD_HEIGHT);
  });

  it('keeps every piece of content inside the safe square — a match card', () => {
    const model = { ...generic, kind: 'match' as const, players: twoPlayers() };
    const layout = cardLayout(model);
    for (const box of contentBoxes(layout)) {
      expect(isInside(layout.safe, box), JSON.stringify(box)).toBe(true);
    }
  });

  it('keeps every piece of content inside the safe square — the generic card', () => {
    const layout = cardLayout(generic);
    for (const box of contentBoxes(layout)) {
      expect(isInside(layout.safe, box), JSON.stringify(box)).toBe(true);
    }
  });

  it('lets nothing sit on top of anything else — the score used to cover both discs', () => {
    const layout = cardLayout({ ...generic, kind: 'match' as const, players: twoPlayers() });
    const boxes = contentBoxes(layout);
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        expect(overlaps(boxes[i], boxes[j]), `${JSON.stringify(boxes[i])} vs ${JSON.stringify(boxes[j])}`).toBe(false);
      }
    }
  });

  it('gives a match card two avatars and two names, and the generic card none', () => {
    expect(cardLayout({ ...generic, kind: 'match', players: twoPlayers() }).avatars).toHaveLength(2);
    expect(cardLayout(generic).avatars).toHaveLength(0);
    expect(cardLayout(generic).names).toHaveLength(0);
  });

  it('spaces the two avatars symmetrically about the centre', () => {
    const layout = cardLayout({ ...generic, kind: 'match', players: twoPlayers() });
    const [left, right] = layout.avatars;
    const centre = CARD_WIDTH / 2;
    expect(centre - (left.x + left.width)).toBe(right.x - centre);
  });
});
