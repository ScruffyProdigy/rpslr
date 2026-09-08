import { describe, expect, it } from 'vitest';
import {
  PLAYER_VOICE,
  ranOutOfTime,
  spectatorVoice,
  takesRound,
  winsMatch,
  youLabel,
} from './voice';

describe('voice', () => {
  it('speaks in second person when no name is given', () => {
    expect(youLabel(PLAYER_VOICE)).toBe('You');
    expect(takesRound(PLAYER_VOICE, 2)).toBe('You take round 2');
    expect(winsMatch(PLAYER_VOICE)).toBe('You win the match!');
    expect(ranOutOfTime(PLAYER_VOICE)).toBe('You ran out of time — a move was picked for you');
  });

  it('names the side when spectating', () => {
    const v = spectatorVoice('Ana');
    expect(youLabel(v)).toBe('Ana');
    expect(takesRound(v, 2)).toBe('Ana takes round 2');
    expect(winsMatch(v)).toBe('Ana wins the match.');
    expect(ranOutOfTime(v)).toBe('Ana ran out of time — a move was picked for them');
  });

  it('treats a blank name as no name, so copy never reads as a bare space', () => {
    expect(youLabel(spectatorVoice('   '))).toBe('You');
  });
});
