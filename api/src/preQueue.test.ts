import { describe, expect, it } from 'vitest';
import { getGameMode } from './gameModes.js';
import {
  DEFAULT_LOADOUT_IDS,
  isPreQueueRejection,
  resolvePreQueueOptions,
  type PreQueueRejection,
  type ResolvedSelection,
} from './preQueue.js';
import type { AssignmentSeat } from './tokens.js';

const DUEL = getGameMode('duel')!;
const HELPERS_MODE = getGameMode('duel-helpers')!;

function seat(seatKey: string, optionIds?: string[]): AssignmentSeat {
  return {
    seatKey,
    lobbyUserId: `u_${seatKey}`,
    options: optionIds ? [{ groupKey: 'helpers', optionIds }] : undefined,
  };
}

function resolved(result: ResolvedSelection[] | PreQueueRejection): ResolvedSelection[] {
  if (isPreQueueRejection(result)) {
    throw new Error(`unexpected rejection: ${JSON.stringify(result)}`);
  }
  return result;
}

describe('resolvePreQueueOptions', () => {
  it('resolves nothing for a mode with no pre-queue pick', () => {
    expect(resolvePreQueueOptions(DUEL, [seat('1'), seat('2')], { require: false })).toEqual([]);
  });

  it('ignores options sent to a mode that never asked for them', () => {
    const result = resolvePreQueueOptions(DUEL, [seat('1', ['ferrus', 'chimera'])], {
      require: false,
    });
    expect(result).toEqual([]);
  });

  it('accepts a valid selection per seat', () => {
    const result = resolved(
      resolvePreQueueOptions(
        HELPERS_MODE,
        [seat('1', ['ferrus', 'chimera']), seat('2', ['oracle', 'copycat'])],
        { require: false },
      ),
    );
    expect(result).toEqual([
      { seatKey: '1', groupKey: 'helpers', optionIds: ['ferrus', 'chimera'], defaulted: false },
      { seatKey: '2', groupKey: 'helpers', optionIds: ['oracle', 'copycat'], defaulted: false },
    ]);
  });

  it('defaults a seat that sent nothing to the duel opening, and says it defaulted', () => {
    const result = resolved(
      resolvePreQueueOptions(HELPERS_MODE, [seat('1'), seat('2', ['oracle', 'copycat'])], {
        require: false,
      }),
    );
    expect(result[0]).toEqual({
      seatKey: '1',
      groupKey: 'helpers',
      optionIds: [...DEFAULT_LOADOUT_IDS],
      defaulted: true,
    });
    expect(result[1].defaulted).toBe(false);
  });

  it('defaults to Ferrus + Featherweight, which is exactly the duel opening', () => {
    expect([...DEFAULT_LOADOUT_IDS]).toEqual(['ferrus', 'featherweight']);
  });

  it('rejects a missing selection once REQUIRE_PREQUEUE_OPTIONS is on', () => {
    const result = resolvePreQueueOptions(HELPERS_MODE, [seat('1')], { require: true });
    expect(result).toMatchObject({
      error: 'invalid pre-queue selection',
      seatKey: '1',
      reason: expect.stringContaining('pre-queue selection is required'),
    });
  });

  it('rejects a selection naming a group the mode does not declare', () => {
    const stray: AssignmentSeat = {
      seatKey: '1',
      lobbyUserId: 'u_1',
      options: [{ groupKey: 'armour', optionIds: ['plate'] }],
    };
    expect(resolvePreQueueOptions(HELPERS_MODE, [stray], { require: false })).toMatchObject({
      seatKey: '1',
      reason: 'unknown pre-queue group: armour',
    });
  });

  it('blames the first failing seat, because a rejection fails the whole provision', () => {
    const result = resolvePreQueueOptions(
      HELPERS_MODE,
      [seat('1', ['ferrus']), seat('2', ['oracle', 'copycat', 'watchful'])],
      { require: false },
    );
    expect(result).toMatchObject({ seatKey: '1' });
  });
});
