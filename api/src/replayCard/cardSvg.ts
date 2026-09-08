/**
 * One template, drawn from the layout boxes. Everything outside the centre
 * square is background: a gradient, safe to crop away.
 */
import { CARD_HEIGHT, CARD_WIDTH, cardLayout, type Box, type CardLayout } from './cardLayout.js';
import type { CardModel, CardPlayer } from './cardModel.js';
import { FONT_BODY, FONT_DISPLAY, TOKENS } from './tokens.js';

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function cardSvg(model: CardModel): string {
  const layout = cardLayout(model);
  const body =
    model.kind === 'match' && model.players.length === 2
      ? matchBody(model, layout)
      : genericBody(model, layout);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
  <defs>
    <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${TOKENS.surface4}"/>
      <stop offset="1" stop-color="${TOKENS.surface1}"/>
    </linearGradient>
  </defs>
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#ground)"/>
  ${body}
</svg>`;
}

function matchBody(model: CardModel, layout: CardLayout): string {
  const [first, second] = model.players;
  return [
    text(layout.headline, escapeXml(model.headline), {
      size: 46,
      weight: 700,
      font: FONT_DISPLAY,
      fill: TOKENS.text,
    }),
    avatar(first, layout.avatars[0], 0),
    avatar(second, layout.avatars[1], 1),
    text(layout.score, escapeXml(`${first.score}–${second.score}`), {
      size: 54,
      weight: 700,
      font: FONT_DISPLAY,
      fill: TOKENS.text,
    }),
    text(layout.names[0], escapeXml(first.name), {
      size: 30,
      weight: 700,
      font: FONT_BODY,
      fill: colourOf(first),
    }),
    text(layout.names[1], escapeXml(second.name), {
      size: 30,
      weight: 700,
      font: FONT_BODY,
      fill: colourOf(second),
    }),
    text(layout.wordmark, 'RPSLR on JoinQuest', {
      size: 26,
      weight: 400,
      font: FONT_BODY,
      fill: TOKENS.muted,
    }),
  ].join('\n  ');
}

function genericBody(model: CardModel, layout: CardLayout): string {
  return [
    text(layout.headline, escapeXml(model.headline), {
      size: 52,
      weight: 700,
      font: FONT_DISPLAY,
      fill: TOKENS.text,
    }),
    text(layout.score, 'RPSLR', { size: 40, weight: 700, font: FONT_DISPLAY, fill: TOKENS.you }),
    text(layout.wordmark, 'joinquest.cc', {
      size: 26,
      weight: 400,
      font: FONT_BODY,
      fill: TOKENS.muted,
    }),
  ].join('\n  ');
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
  const clipId = `avatar-clip-${index}`;

  const inner = player.avatarDataUri
    ? `<clipPath id="${clipId}"><circle cx="${cx}" cy="${cy}" r="${r - 6}"/></clipPath>
  <image href="${escapeXml(player.avatarDataUri)}" x="${cx - r + 6}" y="${cy - r + 6}" width="${(r - 6) * 2}" height="${(r - 6) * 2}" clip-path="url(#${clipId})" preserveAspectRatio="xMidYMid slice"/>`
    : `<text x="${cx}" y="${cy + 22}" text-anchor="middle" font-family="${FONT_DISPLAY}" font-size="64" font-weight="700" fill="${colourOf(player)}">${escapeXml(player.initial)}</text>`;

  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${TOKENS.surface4}" stroke="${ring}" stroke-width="${player.winner ? 8 : 4}"/>
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
