/**
 * Where everything sits on the 1200×630 canvas.
 *
 * WhatsApp, LinkedIn and iMessage's compact form crop the card to its centre
 * square, so every piece of content lives inside x ∈ [285, 915] and the wings
 * carry background only. Keeping the geometry here — as boxes, away from the
 * SVG string — is what lets a test assert that rule instead of a human noticing
 * it went wrong on someone's phone.
 */
import type { CardModel } from './cardModel.js';

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
export const SAFE_SIZE = 630;
export const SAFE_X = (CARD_WIDTH - SAFE_SIZE) / 2;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CardLayout {
  safe: Box;
  headline: Box;
  score: Box;
  avatars: Box[];
  names: Box[];
  wordmark: Box;
}

const AVATAR = 160;
const AVATAR_GAP = 96;
const NAME_WIDTH = 220;
const CENTRE = CARD_WIDTH / 2;

export function cardLayout(model: CardModel): CardLayout {
  const safe: Box = { x: SAFE_X, y: 0, width: SAFE_SIZE, height: SAFE_SIZE };
  const hasPlayers = model.kind === 'match' && model.players.length === 2;

  const headline: Box = { x: SAFE_X + 20, y: 84, width: SAFE_SIZE - 40, height: 62 };
  const score: Box = { x: CENTRE - 90, y: 236, width: 180, height: 92 };
  const wordmark: Box = { x: SAFE_X + 20, y: 520, width: SAFE_SIZE - 40, height: 48 };

  if (!hasPlayers) {
    return { safe, headline, score: { ...score, y: 260 }, avatars: [], names: [], wordmark };
  }

  const avatarY = 200;
  const left: Box = {
    x: CENTRE - AVATAR_GAP / 2 - AVATAR,
    y: avatarY,
    width: AVATAR,
    height: AVATAR,
  };
  const right: Box = { x: CENTRE + AVATAR_GAP / 2, y: avatarY, width: AVATAR, height: AVATAR };
  const nameY = avatarY + AVATAR + 24;

  return {
    safe,
    headline,
    score: { x: CENTRE - AVATAR_GAP / 2, y: avatarY + 46, width: AVATAR_GAP, height: 68 },
    avatars: [left, right],
    names: [
      { x: left.x + left.width / 2 - NAME_WIDTH / 2, y: nameY, width: NAME_WIDTH, height: 44 },
      { x: right.x + right.width / 2 - NAME_WIDTH / 2, y: nameY, width: NAME_WIDTH, height: 44 },
    ],
    wordmark,
  };
}

export function contentBoxes(layout: CardLayout): Box[] {
  return [layout.headline, layout.score, ...layout.avatars, ...layout.names, layout.wordmark];
}

export function isInside(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}
