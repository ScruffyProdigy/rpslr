/** The tags a crawler reads, put where it will look for them. */
import { CARD_HEIGHT, CARD_WIDTH } from './cardLayout.js';
import type { CardModel } from './cardModel.js';

export interface MetaContext {
  model: CardModel;
  pageUrl: string;
  imageUrl: string;
}

const OG_PATTERN = /\s*<meta\s+(?:property|name)="(?:og:[^"]*|twitter:[^"]*)"[^>]*>/gi;

export function renderMetaTags(ctx: MetaContext): string {
  const { model, pageUrl, imageUrl } = ctx;
  return [
    tag('property', 'og:type', 'website'),
    tag('property', 'og:site_name', 'JoinQuest'),
    tag('property', 'og:title', model.ogTitle),
    tag('property', 'og:description', model.ogDescription),
    tag('property', 'og:image', imageUrl),
    tag('property', 'og:image:width', String(CARD_WIDTH)),
    tag('property', 'og:image:height', String(CARD_HEIGHT)),
    tag('property', 'og:image:alt', model.headline),
    tag('property', 'og:url', pageUrl),
    tag('name', 'twitter:card', 'summary_large_image'),
    tag('name', 'twitter:title', model.ogTitle),
    tag('name', 'twitter:description', model.ogDescription),
    tag('name', 'twitter:image', imageUrl),
  ].join('\n    ');
}

export function injectMeta(shell: string, ctx: MetaContext): string {
  const tags = renderMetaTags(ctx);
  const stripped = shell.replace(OG_PATTERN, '');
  if (stripped.includes('</head>')) {
    return stripped.replace('</head>', `    ${tags}\n  </head>`);
  }
  // A shell with no head is not one we wrote, but it still has to work.
  return `${tags}\n${stripped}`;
}

function tag(kind: 'property' | 'name', key: string, value: string): string {
  return `<meta ${kind}="${key}" content="${escapeAttribute(value)}">`;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
