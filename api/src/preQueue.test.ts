import { describe, expect, it } from 'vitest';
import { getGameMode } from './gameModes.js';
import {
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
    expect(resolvePreQueueOptions(DUEL, [seat('1'), seat('2')])).toEqual([]);
  });

  it('ignores options sent to a mode that never asked for them', () => {
    expect(resolvePreQueueOptions(DUEL, [seat('1', ['ferrus', 'chimera'])])).toEqual([]);
  });

  it('accepts a valid selection per seat', () => {
    const result = resolved(
      resolvePreQueueOptions(HELPERS_MODE, [
        seat('1', ['ferrus', 'chimera']),
        seat('2', ['oracle', 'copycat']),
      ]),
    );
    expect(result).toEqual([
      { seatKey: '1', groupKey: 'helpers', optionIds: ['ferrus', 'chimera'] },
      { seatKey: '2', groupKey: 'helpers', optionIds: ['oracle', 'copycat'] },
    ]);
  });

  it('rejects a seat that picked nothing — there is no default loadout', () => {
    const result = resolvePreQueueOptions(HELPERS_MODE, [
      seat('1'),
      seat('2', ['oracle', 'copycat']),
    ]);
    expect(result).toMatchObject({
      error: 'invalid pre-queue selection',
      seatKey: '1',
      reason: expect.stringContaining('pre-queue selection is required'),
    });
  });

  it('never invents a loadout, even one that would reproduce the duel opening', () => {
    const result = resolvePreQueueOptions(HELPERS_MODE, [seat('1'), seat('2')]);
    expect(isPreQueueRejection(result)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('featherweight');
  });

  it('rejects a selection naming a group the mode does not declare', () => {
    const stray: AssignmentSeat = {
      seatKey: '1',
      lobbyUserId: 'u_1',
      options: [{ groupKey: 'armour', optionIds: ['plate'] }],
    };
    expect(resolvePreQueueOptions(HELPERS_MODE, [stray])).toMatchObject({
      seatKey: '1',
      reason: 'unknown pre-queue group: armour',
    });
  });

  it('blames the first failing seat, because a rejection fails the whole provision', () => {
    const result = resolvePreQueueOptions(HELPERS_MODE, [
      seat('1', ['ferrus']),
      seat('2', ['oracle', 'copycat', 'watchful']),
    ]);
    expect(result).toMatchObject({ seatKey: '1' });
  });
});
