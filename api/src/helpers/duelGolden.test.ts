/**
 * `duel` must not have moved.
 *
 * The fixture this compares against was captured on `main`, in a commit that did
 * not touch `game.ts` — a snapshot taken after the refactor would prove nothing.
 * Regenerate it only to record a *deliberate* rules change:
 *
 *     npm run golden:duel
 *
 * A failure means one of two things. Either a duel rule changed, in which case the
 * diff names the exact move sequence, or `rulesFor(null, …)` stopped being the
 * rules this game already had — which is the whole back-compatibility strategy.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { captureGolden, engineTable, openingTable, outcomeGrid } from './duelGolden.js';
import { availableMoves, BASE_RULES, replayMatch, type Move } from '../game.js';
import { DUEL_RULES, rulesFor } from './rules.js';

const FIXTURE = JSON.parse(
  readFileSync(new URL('./__fixtures__/duelGolden.json', import.meta.url), 'utf8'),
);

describe('duel is byte-identical to the engine it had before loadouts', () => {
  it('deals the same opening marks', () => {
    expect(JSON.stringify(openingTable())).toBe(JSON.stringify(FIXTURE.opening));
  });

  it('decides all 25 move pairings the same way', () => {
    expect(JSON.stringify(outcomeGrid())).toBe(JSON.stringify(FIXTURE.outcomes));
  });

  it('leaves the same marks after every one of the 363 legal move sequences', () => {
    const table = engineTable();
    expect(Object.keys(table)).toHaveLength(Object.keys(FIXTURE.engineTable).length);
    // Compared entry by entry so a failure names the sequence rather than dumping
    // the whole lattice.
    for (const [sequence, marks] of Object.entries(table)) {
      expect(JSON.stringify(marks), sequence).toBe(JSON.stringify(FIXTURE.engineTable[sequence]));
    }
  });

  it('plays a whole scripted match to the same state, round by round', async () => {
    const golden = (await captureGolden()) as { duel: unknown };
    expect(JSON.stringify(golden.duel)).toBe(JSON.stringify(FIXTURE.duel));
  });
});

describe('the null loadout is the duel path, not a copy of it', () => {
  it('hands back the very same rules object', () => {
    expect(rulesFor(null, null)).toBe(DUEL_RULES);
    expect(DUEL_RULES).toBe(BASE_RULES);
  });

  it('replays every legal duel sequence to the marks the fixture recorded', () => {
    // The fixture's own table goes through `computeDelays`; this walks the same
    // sequences through `replayMatch`, so the new path is checked against the old
    // numbers rather than against the old code.
    const walk = (played: Move[]): void => {
      if (played.length > 0) {
        const rounds = played.map((move) => ({ a: move, b: move }));
        const { a } = replayMatch(rounds, DUEL_RULES, DUEL_RULES);
        expect(JSON.stringify(a), played.join('>')).toBe(
          JSON.stringify(FIXTURE.engineTable[played.join('>')]),
        );
      }
      if (played.length === 5) return;
      const rounds = played.map((move) => ({ a: move, b: move }));
      const { a } = replayMatch(rounds, DUEL_RULES, DUEL_RULES);
      for (const move of availableMoves(a)) walk([...played, move]);
    };
    walk([]);
  });
});
