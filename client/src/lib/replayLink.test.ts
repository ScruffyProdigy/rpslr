import { describe, expect, it } from 'vitest';
import { buildReplayUrl, replayRef, withReplayAttribution } from './replayLink';

describe('replayRef', () => {
  it('prefers the Lobby id, which is the stable public reference', () => {
    expect(replayRef({ externalMatchId: 'ext-1', code: 'RPS-88SK' })).toBe('ext-1');
  });

  it('falls back to the room code for a standalone match', () => {
    expect(replayRef({ externalMatchId: null, code: 'RPS-88SK' })).toBe('RPS-88SK');
  });

  it('ignores an id that is only whitespace', () => {
    expect(replayRef({ externalMatchId: '   ', code: 'RPS-88SK' })).toBe('RPS-88SK');
  });

  it('has nothing to share when the match has neither', () => {
    expect(replayRef({ externalMatchId: null, code: '' })).toBeNull();
  });
});

describe('buildReplayUrl', () => {
  it('is an absolute link, because it is going somewhere else', () => {
    expect(buildReplayUrl('ext-1', 'https://rpsls-duel.win')).toBe(
      'https://rpsls-duel.win/replay/ext-1',
    );
  });

  it('escapes a reference so a room code can never break the path', () => {
    expect(buildReplayUrl('a b/c', 'https://rpsls-duel.win')).toBe(
      'https://rpsls-duel.win/replay/a%20b%2Fc',
    );
  });

  it('does not double up on a trailing slash', () => {
    expect(buildReplayUrl('ext-1', 'https://rpsls-duel.win/')).toBe(
      'https://rpsls-duel.win/replay/ext-1',
    );
  });
});

describe('withReplayAttribution', () => {
  it('marks a link so Lobby can tell a replay sign-up from any other', () => {
    expect(withReplayAttribution('https://joinquest.example/games/rpslr')).toBe(
      'https://joinquest.example/games/rpslr?ref=replay',
    );
  });

  it('keeps the query a link already carries', () => {
    expect(withReplayAttribution('https://joinquest.example/g?match=ext-1')).toBe(
      'https://joinquest.example/g?match=ext-1&ref=replay',
    );
  });

  it('leaves a relative link usable', () => {
    expect(withReplayAttribution('/return')).toBe('/return?ref=replay');
  });
});

describe('buildReplayUrl with a sharer', () => {
  it("appends the sharer's seat so their card reads as a win", () => {
    expect(buildReplayUrl('ext-1', 'https://rpsls-duel.win', { by: '1' })).toBe(
      'https://rpsls-duel.win/replay/ext-1?by=1',
    );
  });

  it('leaves the link neutral when no seat is given', () => {
    expect(buildReplayUrl('ext-1', 'https://rpsls-duel.win')).toBe(
      'https://rpsls-duel.win/replay/ext-1',
    );
    expect(buildReplayUrl('ext-1', 'https://rpsls-duel.win', { by: null })).toBe(
      'https://rpsls-duel.win/replay/ext-1',
    );
  });

  it('escapes a seat key that would otherwise change the query', () => {
    expect(buildReplayUrl('ext-1', 'https://x.test', { by: 'a&b=c' })).toBe(
      'https://x.test/replay/ext-1?by=a%26b%3Dc',
    );
  });
});
