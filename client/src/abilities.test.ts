import { describe, expect, it } from 'vitest';
import type { AbilityFiring } from '@game/types';
import type { Loadout } from '@game/helpers/loadout';
import {
  chargeReading,
  describeFiring,
  heldAbilities,
  legalTargets,
  targetSteps,
} from './abilities';

/** A loadout is any two distinct helpers; only a Major can carry a charge. */
function loadoutWith(majorId: string): Loadout {
  return [majorId, 'echo-chamber'] as unknown as Loadout;
}

const CLEAR = { rock: 0, paper: 0, scissors: 0, lizard: 0, robot: 0 };

describe('chargeReading (JQ-221)', () => {
  it('reads a zero-mark charge as ready', () => {
    expect(chargeReading({ marks: 0, available: true })).toEqual({
      kind: 'ready',
      label: 'Ready',
    });
  });

  it('reads marks left as a countdown, pluralised', () => {
    expect(chargeReading({ marks: 1, available: false })).toEqual({
      kind: 'recharging',
      label: '1 more round',
    });
    expect(chargeReading({ marks: 3, available: false })).toEqual({
      kind: 'recharging',
      label: '3 more rounds',
    });
  });

  /*
   * The one reading that must not be arithmetic. `marks: null` is the server
   * saying "never again this match", and it is deliberately not Infinity so that
   * a client comparing `marks > 0` cannot read it as available — so this branches
   * on null before it compares anything.
   */
  it('reads a null mark count as spent for the match, not as ready', () => {
    expect(chargeReading({ marks: null, available: false })).toEqual({
      kind: 'spent',
      label: 'Spent',
    });
  });

  it('never calls a charge ready on `available` alone', () => {
    // A pending firing this round suppresses availability without moving marks.
    expect(chargeReading({ marks: 0, available: false }).kind).toBe('ready');
  });
});

describe('heldAbilities (JQ-221)', () => {
  it('is empty for the null loadout, which is what duel brings', () => {
    expect(heldAbilities(null, {})).toEqual([]);
  });

  it('is empty for a loadout whose Major is a passive', () => {
    expect(heldAbilities(loadoutWith('chimera'), {})).toEqual([]);
  });

  it('names the card from the roster rather than a second copy of it', () => {
    const held = heldAbilities(loadoutWith('rust'), { rust: { marks: 0, available: true } });
    expect(held).toHaveLength(1);
    expect(held[0].id).toBe('rust');
    expect(held[0].name).toBe('Rust');
    expect(held[0].blurb).toBe('Add 2 marks to a move they currently have live.');
    expect(held[0].charge).toEqual({ marks: 0, available: true });
  });

  /*
   * A held ability the map says nothing about is still held. It reads as spent
   * rather than vanishing: a card that disappears from the rail would read as a
   * card you never brought.
   */
  it('keeps a held ability the charge map omits, read as spent', () => {
    const held = heldAbilities(loadoutWith('rust'), {});
    expect(held[0].charge).toEqual({ marks: null, available: false });
  });
});

describe('targetSteps (JQ-221)', () => {
  it('gives Sacrifice, Freeze and Oracle no steps', () => {
    for (const id of ['sacrifice', 'freeze', 'oracle']) expect(targetSteps(id)).toEqual([]);
  });

  it('gives Quarantine and Rust one target step', () => {
    for (const id of ['quarantine', 'rust']) {
      expect(targetSteps(id).map((s) => s.field)).toEqual(['target']);
    }
  });

  it('gives Thief a source step before its target step', () => {
    expect(targetSteps('thief').map((s) => s.field)).toEqual(['source', 'target']);
  });
});

describe('legalTargets (JQ-221)', () => {
  const marks = { own: { ...CLEAR, rock: 2 }, opponent: { ...CLEAR, scissors: 1 } };

  /*
   * Quarantine is fired blind at a move the opponent has not chosen yet, so every
   * move is a legal guess — `namedMovesFor` checks nothing but that it is a move.
   */
  it('lets Quarantine name any move', () => {
    const [step] = targetSteps('quarantine');
    expect(legalTargets('quarantine', step, marks)).toEqual([
      'rock',
      'paper',
      'scissors',
      'lizard',
      'robot',
    ]);
  });

  it('limits Rust to opponent moves that carry a mark', () => {
    const [step] = targetSteps('rust');
    expect(legalTargets('rust', step, marks)).toEqual(['scissors']);
  });

  it("limits Thief's source to your own marked moves, and its target to any of theirs", () => {
    const [source, target] = targetSteps('thief');
    expect(legalTargets('thief', source, marks)).toEqual(['rock']);
    expect(legalTargets('thief', target, marks)).toEqual([
      'rock',
      'paper',
      'scissors',
      'lizard',
      'robot',
    ]);
  });

  it('says why an illegal target is illegal', () => {
    const [step] = targetSteps('rust');
    expect(step.rejection('rock')).toBe('Rock is clear — Rust needs a move they have on cooldown');
    const [source] = targetSteps('thief');
    expect(source.rejection('paper')).toBe('Paper is clear — Thief needs a mark of yours to take');
  });
});

describe('describeFiring (JQ-221)', () => {
  const fired = (over: Partial<AbilityFiring>): AbilityFiring => ({
    round: 3,
    seatKey: 'a',
    helperId: 'rust',
    target: null,
    source: null,
    ...over,
  });

  it('reads a named target in the second person for your own firing', () => {
    expect(describeFiring(fired({ target: 'scissors' }), 'a')).toBe(
      'Rust — you added 2 marks to their Scissors',
    );
  });

  it('flips the persons for the opponent', () => {
    expect(describeFiring(fired({ target: 'scissors' }), 'b')).toBe(
      'Rust — they added 2 marks to your Scissors',
    );
  });

  it("names both ends of Thief's move", () => {
    expect(describeFiring(fired({ helperId: 'thief', source: 'rock', target: 'paper' }), 'a')).toBe(
      'Thief — you moved a mark from your Rock onto their Paper',
    );
  });

  it('reads a targetless ability without inventing a move', () => {
    expect(describeFiring(fired({ helperId: 'freeze' }), 'a')).toBe(
      "Freeze — you stopped their marks decrementing",
    );
  });

  /*
   * Oracle's target is written by the server once both players lock in, and is
   * null when the opponent played their only live move. Both read as a firing
   * that happened, because the charge was spent either way.
   */
  it('reads Oracle with and without a named move', () => {
    expect(describeFiring(fired({ helperId: 'oracle', target: 'lizard' }), 'a')).toBe(
      'Oracle — you learned they did not play Lizard',
    );
    expect(describeFiring(fired({ helperId: 'oracle' }), 'a')).toBe(
      'Oracle — there was nothing they did not play',
    );
  });
});
