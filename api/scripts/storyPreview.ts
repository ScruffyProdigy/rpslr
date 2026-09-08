/**
 * Writes a story card to disk so a human can look at it. Every assertion in
 * storyLayout.test.ts can pass on a card that still looks wrong, and the
 * end-to-end check the ticket asks for needs a phone this cannot reach.
 *
 * Usage: npm run story:preview -- /tmp/story.png [match|nowin|generic]
 */
import { writeFileSync } from 'node:fs';
import { renderStoryPng } from '../src/replayCard/cardImage.js';
import { genericCardModel, type CardModel } from '../src/replayCard/cardModel.js';
import { storySvg } from '../src/replayCard/storySvg.js';

const out = process.argv[2] ?? 'story-preview.png';
const kind = process.argv[3] ?? 'match';

/** A stand-in match, so the preview needs no database and no finished game. */
const sample: CardModel = {
  kind: 'match',
  ref: 'preview',
  headline: 'Ana wins 3–1',
  ogTitle: 'Ana wins 3–1!',
  ogDescription: '1 Rock over Scissors · 2 Rock over Lizard · 3 draw · 4 Robot over Rock',
  cacheable: true,
  shortCode: 'RPS-K7M2',
  showdown: { round: 4, winnerMove: 'robot', loserMove: 'rock', caption: 'Robot vaporizes Rock' },
  players: [
    { seatKey: '1', name: 'Ana', score: 3, role: 'you', avatarUrl: null, avatarDataUri: null, initial: 'A', winner: true },
    { seatKey: '2', name: 'Ben', score: 1, role: 'opp', avatarUrl: null, avatarDataUri: null, initial: 'B', winner: false },
  ],
};

const model =
  kind === 'generic'
    ? genericCardModel('preview')
    : kind === 'nowin'
      ? { ...sample, headline: 'Ana vs Ben · 2–2', showdown: null }
      : sample;

writeFileSync(out, renderStoryPng(storySvg(model, { origin: 'https://rpsls-duel.win' })));
console.log(`wrote ${out}`);
