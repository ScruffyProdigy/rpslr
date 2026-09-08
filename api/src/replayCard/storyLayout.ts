/**
 * Where everything sits on the 1080×1920 story canvas.
 *
 * Instagram draws its own chrome over a story — the author's name and the close
 * button above, the reply bar and the sticker row below — and none of it is
 * ours to move. So content lives in the middle band and the ends carry
 * background only, the same bargain `cardLayout` makes with the centre square.
 *
 * The geometry is here, as boxes, away from the SVG string, so a test can
 * assert the rule instead of a human noticing it went wrong on someone's phone
 * after the story is already up.
 */
import type { Box } from './cardLayout.js';
import type { CardModel } from './cardModel.js';

export const STORY_WIDTH = 1080;
export const STORY_HEIGHT = 1920;

/**
 * Instagram's reserved bands, in pixels at 1080×1920. 250 is the figure their
 * own creator guidance gives, and it matches where the reply bar lands on a
 * 19.5:9 phone.
 */
export const SAFE_TOP = 250;
export const SAFE_BOTTOM = STORY_HEIGHT - 250;
/** Not Instagram's rule — ours. Type running to the bezel reads as a mistake. */
export const SAFE_GUTTER = 60;

const CENTRE = STORY_WIDTH / 2;
const AVATAR = 260;
/** Wide enough for the score to sit between the discs without touching either. */
const AVATAR_GAP = 280;
const NAME_WIDTH = 300;
const ICON = 200;
export const QR_SIZE = 260;

export interface StoryLayout {
  safe: Box;
  headline: Box;
  avatars: Box[];
  names: Box[];
  score: Box;
  /** Empty when the match has no deciding round to draw. */
  showdown: { winner: Box; verb: Box; loser: Box; caption: Box } | null;
  /** Null when there is no short code, so nothing to encode or print. */
  shortLink: { qr: Box; url: Box } | null;
  wordmark: Box;
}

export function storyLayout(model: CardModel): StoryLayout {
  const safe: Box = {
    x: SAFE_GUTTER,
    y: SAFE_TOP,
    width: STORY_WIDTH - SAFE_GUTTER * 2,
    height: SAFE_BOTTOM - SAFE_TOP,
  };
  const hasPlayers = model.kind === 'match' && model.players.length === 2;

  const headline: Box = { x: SAFE_GUTTER, y: 270, width: safe.width, height: 100 };
  const wordmark: Box = { x: SAFE_GUTTER, y: 1590, width: safe.width, height: 70 };

  // Stacked, not side by side. A URL beside a 260px QR has 540px to live in,
  // and `rpsls-duel.win/r/RPS-K7M2` set large enough to read across a room does
  // not fit in 540 — the first draft ran it out past the gutter. Under the QR
  // it gets the full width, which is the shape a 9:16 canvas wants anyway.
  const shortLink = model.shortCode
    ? {
        qr: { x: CENTRE - QR_SIZE / 2, y: 1210, width: QR_SIZE, height: QR_SIZE },
        url: { x: SAFE_GUTTER, y: 1490, width: safe.width, height: 70 },
      }
    : null;

  if (!hasPlayers) {
    return {
      safe,
      headline,
      avatars: [],
      names: [],
      // Nothing flanks it, so the generic card's mark takes the middle.
      score: { x: SAFE_GUTTER, y: 800, width: safe.width, height: 140 },
      showdown: null,
      shortLink,
      wordmark,
    };
  }

  const avatarY = 420;
  const left: Box = {
    x: CENTRE - AVATAR_GAP / 2 - AVATAR,
    y: avatarY,
    width: AVATAR,
    height: AVATAR,
  };
  const right: Box = { x: CENTRE + AVATAR_GAP / 2, y: avatarY, width: AVATAR, height: AVATAR };
  const nameY = avatarY + AVATAR + 20;

  const iconY = 830;
  const showdown = model.showdown
    ? {
        winner: { x: 200, y: iconY, width: ICON, height: ICON },
        verb: { x: 410, y: 885, width: 260, height: 90 },
        loser: { x: 680, y: iconY, width: ICON, height: ICON },
        caption: { x: SAFE_GUTTER, y: 1060, width: safe.width, height: 70 },
      }
    : null;

  return {
    safe,
    headline,
    avatars: [left, right],
    names: [
      { x: left.x + left.width / 2 - NAME_WIDTH / 2, y: nameY, width: NAME_WIDTH, height: 56 },
      { x: right.x + right.width / 2 - NAME_WIDTH / 2, y: nameY, width: NAME_WIDTH, height: 56 },
    ],
    score: {
      x: CENTRE - AVATAR_GAP / 2 + 16,
      y: avatarY + (AVATAR - 110) / 2,
      width: AVATAR_GAP - 32,
      height: 110,
    },
    showdown,
    shortLink,
    wordmark,
  };
}

/** Everything the template actually draws, for the safe-zone and overlap tests. */
export function storyContentBoxes(layout: StoryLayout): Box[] {
  return [
    layout.headline,
    ...layout.avatars,
    ...layout.names,
    layout.score,
    ...(layout.showdown
      ? [layout.showdown.winner, layout.showdown.verb, layout.showdown.loser, layout.showdown.caption]
      : []),
    ...(layout.shortLink ? [layout.shortLink.qr, layout.shortLink.url] : []),
    layout.wordmark,
  ];
}
