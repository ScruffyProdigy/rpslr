import { describe, expect, it } from 'vitest';
import { buildLaunchUrlsForAssignment } from './launchUrls.js';

describe('buildLaunchUrlsForAssignment', () => {
  it('mints query-style per-player URLs', () => {
    const urls = buildLaunchUrlsForAssignment('https://rpsls-duel.win', {
      externalMatchId: 'sess-abc',
      seats: [
        { seatKey: '1', lobbyUserId: 'user-a' },
        { seatKey: '2', lobbyUserId: 'user-b' },
      ],
    });
    expect(urls['user-a']).toBe('https://rpsls-duel.win/?match=sess-abc&seat=1');
    expect(urls['user-b']).toBe('https://rpsls-duel.win/?match=sess-abc&seat=2');
  });

  it('does not embed JWTs in launch URL bases', () => {
    const urls = buildLaunchUrlsForAssignment('https://rpsls-duel.win', {
      externalMatchId: 'sess-abc',
      seats: [{ seatKey: '1', lobbyUserId: 'user-a' }],
    });
    for (const url of Object.values(urls)) {
      expect(url).not.toMatch(/token=/);
      expect(url).not.toMatch(/^eyJ/);
    }
  });
});
