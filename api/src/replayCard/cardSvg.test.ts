import { describe, expect, it } from 'vitest';
import { cardSvg, escapeXml } from './cardSvg.js';
import { genericCardModel, type CardModel } from './cardModel.js';
import { TOKENS } from './tokens.js';

const match: CardModel = {
  kind: 'match',
  ref: 'ext-1',
  headline: 'Ana vs Ben · 3–1',
  ogTitle: 'Ana beat Ben 3–1 in RPSLR',
  ogDescription: '1 Rock over Scissors',
  cacheable: true,
  players: [
    { seatKey: '1', name: 'Ana', score: 3, role: 'you', avatarUrl: null, avatarDataUri: 'data:image/png;base64,AAA', initial: 'A', winner: true },
    { seatKey: '2', name: 'Ben', score: 1, role: 'opp', avatarUrl: null, avatarDataUri: null, initial: 'B', winner: false },
  ],
};

describe('cardSvg', () => {
  it('declares the exact card size', () => {
    const svg = cardSvg(match);
    expect(svg).toContain('width="1200"');
    expect(svg).toContain('height="630"');
    expect(svg).toContain('viewBox="0 0 1200 630"');
  });

  it('dresses each seat in the colour it wore on the board', () => {
    const svg = cardSvg(match);
    expect(svg).toContain(TOKENS.you);
    expect(svg).toContain(TOKENS.opp);
  });

  it('rings the winner in gold and leaves the loser unringed', () => {
    expect(cardSvg(match).match(new RegExp(TOKENS.trophy, 'g'))?.length).toBe(1);
  });

  it('embeds an avatar it was given and draws an initial where it was not', () => {
    const svg = cardSvg(match);
    expect(svg).toContain('data:image/png;base64,AAA');
    expect(svg).toContain('>B</text>');
  });

  it('escapes a name that is trying to be markup', () => {
    const hostile = {
      ...match,
      headline: '<script>x</script>',
      players: [{ ...match.players[0], name: 'A&B' }, match.players[1]],
    };
    const svg = cardSvg(hostile);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('A&amp;B');
  });

  it('renders the generic card without players', () => {
    const svg = cardSvg(genericCardModel('missing'));
    expect(svg).toContain('RPSLR on JoinQuest');
    expect(svg).not.toContain('<image');
  });
});

describe('escapeXml', () => {
  it('escapes the five characters that break XML', () => {
    expect(escapeXml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&apos;');
  });
});
