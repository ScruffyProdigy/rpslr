import { describe, expect, it } from 'vitest';
import { injectMeta, renderMetaTags } from './metaHtml.js';
import { genericCardModel, type CardModel } from './cardModel.js';

const model: CardModel = {
  kind: 'match',
  ref: 'ext-1',
  headline: 'Ana vs Ben · 3–1',
  ogTitle: 'Ana beat Ben 3–1 in RPSLR',
  ogDescription: '1 Rock over Scissors',
  cacheable: true,
  players: [],
};

const ctx = {
  model,
  pageUrl: 'https://rpsls-duel.win/replay/ext-1',
  imageUrl: 'https://rpsls-duel.win/api/v1/replay/ext-1/card.png',
};

describe('renderMetaTags', () => {
  it('carries every tag a crawler reads', () => {
    const tags = renderMetaTags(ctx);
    expect(tags).toContain('<meta property="og:title" content="Ana beat Ben 3–1 in RPSLR">');
    expect(tags).toContain('<meta property="og:description" content="1 Rock over Scissors">');
    expect(tags).toContain(`<meta property="og:image" content="${ctx.imageUrl}">`);
    expect(tags).toContain('<meta property="og:image:width" content="1200">');
    expect(tags).toContain('<meta property="og:image:height" content="630">');
    expect(tags).toContain(`<meta property="og:url" content="${ctx.pageUrl}">`);
    expect(tags).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(tags).toContain(`<meta name="twitter:image" content="${ctx.imageUrl}">`);
  });

  it('escapes a title trying to close the attribute', () => {
    const hostile = { ...ctx, model: { ...model, ogTitle: '"><script>alert(1)</script>' } };
    const tags = renderMetaTags(hostile);
    expect(tags).not.toContain('<script>');
    expect(tags).toContain('&quot;&gt;&lt;script&gt;');
  });
});

describe('injectMeta', () => {
  const shell =
    '<!doctype html><html><head><title>RPSLR</title></head><body><script src="/assets/x.js"></script></body></html>';

  it('keeps the SPA the client shipped', () => {
    const html = injectMeta(shell, ctx);
    expect(html).toContain('<script src="/assets/x.js"></script>');
    expect(html).toContain('og:title');
    expect(html.indexOf('og:title')).toBeLessThan(html.indexOf('</head>'));
  });

  it('replaces meta the shell already had rather than doubling it', () => {
    const withOld = shell.replace('</head>', '<meta property="og:title" content="old"></head>');
    const html = injectMeta(withOld, ctx);
    expect(html.match(/og:title/g)).toHaveLength(1);
    expect(html).not.toContain('content="old"');
  });

  it('still produces a document when the shell has no head to inject into', () => {
    const html = injectMeta('<html><body>hi</body></html>', ctx);
    expect(html).toContain('og:title');
  });

  it('works for the generic card', () => {
    expect(injectMeta(shell, { ...ctx, model: genericCardModel('missing') })).toContain(
      'RPSLR on JoinQuest',
    );
  });
});
