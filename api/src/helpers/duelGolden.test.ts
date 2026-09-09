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
 *
 * The `duel` snapshot has been re-captured twice, both times for a `MatchState`
 * shape change and never for a rules change:
 *
 *   - JQ-148: `MatchState` gained `abilityFirings`, and a seat gained `loadout` and
 *     `loadoutRoll`. Thirty insertions, no deletions.
 *   - JQ-220: `MatchState` gained `abilities`, the viewing seat's charge state.
 *     Six insertions — one empty object per captured snapshot — and no deletions.
 *
 * "No deletions" is the whole argument in both cases: not one recorded value moved,
 * so the new field is additive by proof rather than by assertion. The test below
 * pins all four fields at their duel values so a shape change cannot be a rules
 * change wearing a new field's clothes. `opening`, `outcomes` and `engineTable` are
 * untouched from the original capture, and they are where the guarantee really sits.
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
  it('leaves a duel seat carrying no loadout, no charges, and the match no firings', () => {
    const state = FIXTURE.duel.final as {
      abilityFirings: unknown[];
      abilities: Record<string, unknown>;
      seats: { loadout: unknown; loadoutRoll: unknown }[];
    };
    expect(state.abilityFirings).toEqual([]);
    // A duel seat holds no abilities, so it has no charges to report — the firing
    // path is not merely unused here, it has nothing to be used on.
    expect(state.abilities).toEqual({});
    for (const seat of state.seats) {
      expect(seat.loadout).toBeNull();
      expect(seat.loadoutRoll).toBeNull();
    }
  });

  it('hands back the very same rules object', () => {
    expect(rulesFor(null)).toBe(DUEL_RULES);
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
