import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MOVES } from '../game.js';
import { moveArtSvg } from './moveArt.js';

const CLIENT_ICON = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../client/src/components/MoveIcon.tsx',
);

describe('moveArtSvg', () => {
  it('draws every move the game has', () => {
    for (const move of MOVES) {
      expect(moveArtSvg(move, { x: 0, y: 0, size: 100 }, { tint: '#abc', ground: '#123' })).toContain(
        '<path',
      );
    }
  });

  it('paints the silhouette in the tint and the cut-outs in the ground', () => {
    const svg = moveArtSvg('robot', { x: 0, y: 0, size: 100 }, { tint: '#6c8cff', ground: '#0f1117' });
    expect(svg).toContain('#6c8cff');
    expect(svg).toContain('#0f1117');
    // Nothing may still be the mask's own black-and-white: on the card those
    // are a white blob and a black hole, not an icon.
    expect(svg).not.toContain('#fff');
    expect(svg).not.toContain('#000');
  });

  it('places and scales the art into the box it was given', () => {
    const svg = moveArtSvg('rock', { x: 120, y: 340, size: 96 }, { tint: '#abc', ground: '#123' });
    expect(svg).toContain('translate(120 340)');
    expect(svg).toContain('scale(4)');
  });

  /**
   * The copy is only safe while something notices it drifting. Comparing the
   * path data — not the markup, which differs by JSX attribute casing — catches
   * a move redrawn in the client and not here.
   */
  it('carries the same path data the client draws', () => {
    const client = readFileSync(CLIENT_ICON, 'utf8');
    for (const move of MOVES) {
      const svg = moveArtSvg(move, { x: 0, y: 0, size: 24 }, { tint: '#fff', ground: '#000' });
      for (const [, d] of svg.matchAll(/ d="([^"]+)"/g)) {
        expect(client, `${move}: path missing from MoveIcon.tsx`).toContain(d);
      }
    }
  });
});
