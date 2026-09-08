/**
 * The story card: the same match, the same tokens and the same discs as the
 * link-preview card, drawn tall for a phone and with two things that card has
 * no room for — the round that won the match, and a way back in that survives
 * being screenshotted.
 */
import type { Box } from './cardLayout.js';
import type { CardModel, CardPlayer } from './cardModel.js';
import { escapeXml } from './cardSvg.js';
import { moveArtSvg } from './moveArt.js';
import { beatVerb } from './moveVerbs.js';
import { qrArt } from './qrSvg.js';
import {
  STORY_HEIGHT,
  STORY_WIDTH,
  storyLayout,
  type StoryLayout,
} from './storyLayout.js';
import { FONT_BODY, FONT_DISPLAY, TOKENS } from './tokens.js';

export interface StorySvgOptions {
  /** Origin the printed link and the QR point at, e.g. https://rpsls-duel.win. */
  origin: string;
}

export function storySvg(model: CardModel, opts: StorySvgOptions): string {
  const layout = storyLayout(model);
  const body =
    model.kind === 'match' && model.players.length === 2
      ? matchBody(model, layout, opts)
      : genericBody(model, layout);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${STORY_WIDTH}" height="${STORY_HEIGHT}" viewBox="0 0 ${STORY_WIDTH} ${STORY_HEIGHT}">
  <defs>
    <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${TOKENS.surface4}"/>
      <stop offset="1" stop-color="${TOKENS.surface1}"/>
    </linearGradient>
  </defs>
  <rect width="${STORY_WIDTH}" height="${STORY_HEIGHT}" fill="url(#ground)"/>
  ${body}
</svg>`;
}

/** The short link as it is printed and as the QR encodes it — one source. */
export function shortLinkUrl(origin: string, shortCode: string): string {
  return `${origin.replace(/\/$/, '')}/r/${encodeURIComponent(shortCode)}`;
}

function matchBody(model: CardModel, layout: StoryLayout, opts: StorySvgOptions): string {
  const [first, second] = model.players;
  return [
    text(layout.headline, escapeXml(model.headline), {
      size: 72,
      weight: 700,
      font: FONT_DISPLAY,
      fill: TOKENS.text,
    }),
    avatar(first, layout.avatars[0], 0),
    avatar(second, layout.avatars[1], 1),
    text(layout.score, escapeXml(`${first.score}–${second.score}`), {
      size: 84,
      weight: 700,
      font: FONT_DISPLAY,
      fill: TOKENS.text,
    }),
    text(layout.names[0], escapeXml(first.name), {
      size: 42,
      weight: 700,
      font: FONT_BODY,
      fill: colourOf(first),
    }),
    text(layout.names[1], escapeXml(second.name), {
      size: 42,
      weight: 700,
      font: FONT_BODY,
      fill: colourOf(second),
    }),
    showdown(model, layout),
    shortLink(model, layout, opts.origin),
    text(layout.wordmark, 'RPSLR on JoinQuest', {
      size: 40,
      weight: 400,
      font: FONT_BODY,
      fill: TOKENS.muted,
    }),
  ]
    .filter(Boolean)
    .join('\n  ');
}

function genericBody(model: CardModel, layout: StoryLayout): string {
  return [
    text(layout.headline, escapeXml(model.headline), {
      size: 72,
      weight: 700,
      font: FONT_DISPLAY,
      fill: TOKENS.text,
    }),
    text(layout.score, 'RPSLR', { size: 120, weight: 700, font: FONT_DISPLAY, fill: TOKENS.you }),
    text(layout.wordmark, 'joinquest.cc', {
      size: 40,
      weight: 400,
      font: FONT_BODY,
      fill: TOKENS.muted,
    }),
  ].join('\n  ');
}

/**
 * The round that ended it: the winning move, the verb, the losing move, and the
 * whole phrase spelled out underneath for anyone who cannot read two icons at
 * arm's length on a moving screen.
 */
function showdown(model: CardModel, layout: StoryLayout): string {
  if (!model.showdown || !layout.showdown) return '';
  const { winnerMove, loserMove, caption, round } = model.showdown;
  const [first, second] = model.players;
  const boxes = layout.showdown;

  // Asked for, not sliced out of the caption: a verb is a word about two moves,
  // and the table that knows it is one import away.
  const verb = beatVerb(winnerMove, loserMove) ?? '';

  return [
    moveArtSvg(
      winnerMove,
      { x: boxes.winner.x, y: boxes.winner.y, size: boxes.winner.width },
      { tint: colourOf(first), ground: TOKENS.surface1 },
    ),
    text(boxes.verb, escapeXml(verb), {
      size: 40,
      weight: 400,
      font: FONT_BODY,
      fill: TOKENS.muted,
    }),
    moveArtSvg(
      loserMove,
      { x: boxes.loser.x, y: boxes.loser.y, size: boxes.loser.width },
      { tint: colourOf(second), ground: TOKENS.surface1 },
    ),
    text(boxes.caption, escapeXml(`Round ${round} · ${caption}`), {
      size: 44,
      weight: 700,
      font: FONT_BODY,
      fill: TOKENS.text,
    }),
  ].join('\n  ');
}

/**
 * The QR and the link beside it. A story gets screenshotted and a screenshot
 * cannot be tapped, so both are here: the QR for a phone pointed at the screen,
 * the printed link for someone who would rather type four characters.
 */
function shortLink(model: CardModel, layout: StoryLayout, origin: string): string {
  if (!model.shortCode || !layout.shortLink) return '';
  const url = shortLinkUrl(origin, model.shortCode);
  const { qr, url: urlBox } = layout.shortLink;
  const art = qrArt(url, qr.width);

  // A QR that could not be built costs the card nothing else: the link beside
  // it still reads, which is what the QR was an improvement on.
  const code = art
    ? `<rect x="${qr.x}" y="${qr.y}" width="${qr.width}" height="${qr.height}" rx="12" fill="${TOKENS.text}"/>
  <g transform="translate(${qr.x} ${qr.y})"><path d="${art.path}" fill="${TOKENS.surface1}"/></g>`
    : '';

  // Printed without the scheme: it is a URL to type, not one to click.
  const printed = url.replace(/^https?:\/\//, '');
  return [
    code,
    text(urlBox, escapeXml(printed), {
      size: 52,
      weight: 700,
      font: FONT_BODY,
      fill: TOKENS.text,
    }),
  ]
    .filter(Boolean)
    .join('\n  ');
}

function colourOf(player: CardPlayer): string {
  return player.role === 'you' ? TOKENS.you : TOKENS.opp;
}

/** A disc: the avatar if we have one, the initial if we do not, gold ring if they won. */
function avatar(player: CardPlayer, box: Box, index: number): string {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const r = box.width / 2;
  const ring = player.winner ? TOKENS.trophy : colourOf(player);
  // Distinct from the link card's ids: both may end up in one document.
  const clipId = `story-avatar-clip-${index}`;

  const inner = player.avatarDataUri
    ? `<clipPath id="${clipId}"><circle cx="${cx}" cy="${cy}" r="${r - 10}"/></clipPath>
  <image href="${escapeXml(player.avatarDataUri)}" x="${cx - r + 10}" y="${cy - r + 10}" width="${(r - 10) * 2}" height="${(r - 10) * 2}" clip-path="url(#${clipId})" preserveAspectRatio="xMidYMid slice"/>`
    : `<text x="${cx}" y="${cy + 36}" text-anchor="middle" font-family="${FONT_DISPLAY}" font-size="104" font-weight="700" fill="${colourOf(player)}">${escapeXml(player.initial)}</text>`;

  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${TOKENS.surface4}" stroke="${ring}" stroke-width="${player.winner ? 12 : 6}"/>
  ${inner}`;
}

function text(
  box: Box,
  content: string,
  opts: { size: number; weight: number; font: string; fill: string },
): string {
  const cx = box.x + box.width / 2;
  const baseline = box.y + box.height * 0.75;
  return `<text x="${cx}" y="${baseline}" text-anchor="middle" font-family="${opts.font}" font-size="${opts.size}" font-weight="${opts.weight}" fill="${opts.fill}">${content}</text>`;
}
