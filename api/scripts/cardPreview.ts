/**
 * Writes a card to disk so a human can look at it. A card that passes every
 * assertion can still look wrong.
 *
 * Usage: npm run card:preview -- /tmp/card.png [match|generic]
 */
import { writeFileSync } from 'node:fs';
import { renderCardPng } from '../src/replayCard/cardImage.js';
import { cardSvg } from '../src/replayCard/cardSvg.js';
import { genericCardModel, type CardModel } from '../src/replayCard/cardModel.js';

const out = process.argv[2] ?? 'card-preview.png';
const kind = process.argv[3] ?? 'match';

/** A stand-in match, so the preview needs no database and no finished game. */
const sample: CardModel = {
  kind: 'match',
  ref: 'preview',
  headline: 'Ana vs Ben · 3–1',
  ogTitle: 'Ana beat Ben 3–1 in RPSLR',
  ogDescription: '1 Rock over Scissors · 2 Rock over Lizard · 3 draw · 4 Robot over Rock',
  cacheable: true,
  players: [
    { seatKey: '1', name: 'Ana', score: 3, role: 'you', avatarUrl: null, avatarDataUri: null, initial: 'A', winner: true },
    { seatKey: '2', name: 'Ben', score: 1, role: 'opp', avatarUrl: null, avatarDataUri: null, initial: 'B', winner: false },
  ],
};

const model = kind === 'generic' ? genericCardModel('preview') : sample;
writeFileSync(out, renderCardPng(cardSvg(model)));
console.log(`wrote ${out}`);
