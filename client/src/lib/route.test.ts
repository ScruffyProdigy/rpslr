import { describe, expect, it } from 'vitest';
import { parseRoute } from './route';

describe('parseRoute', () => {
  it('reads the match id out of a replay path', () => {
    expect(parseRoute('/replay/ext-123')).toEqual({ name: 'replay', id: 'ext-123' });
  });

  it('tolerates a trailing slash', () => {
    expect(parseRoute('/replay/ext-123/')).toEqual({ name: 'replay', id: 'ext-123' });
  });

  it('decodes an escaped id', () => {
    expect(parseRoute('/replay/a%20b')).toEqual({ name: 'replay', id: 'a b' });
  });

  it('falls back to the match screen for anything else', () => {
    expect(parseRoute('/')).toEqual({ name: 'match' });
    expect(parseRoute('/replay')).toEqual({ name: 'match' });
    expect(parseRoute('/replay/')).toEqual({ name: 'match' });
    expect(parseRoute('/replay/a/b')).toEqual({ name: 'match' });
  });
});
