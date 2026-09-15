import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AbilityMap } from '@game/helpers/abilities';
import type { Loadout } from '@game/helpers/loadout';
import { heldAbilities, type MarksBySide } from '../abilities';
import { useAbilityTargeting } from './useAbilityTargeting';

const CLEAR = { rock: 0, paper: 0, scissors: 0, lizard: 0, robot: 0 };

/** A loadout is two helper ids; the second is a passive that holds no slot. */
function loadoutWith(majorId: string): Loadout {
  return [majorId, 'echo-chamber'] as unknown as Loadout;
}

interface Setup {
  loadout?: Loadout;
  abilities?: AbilityMap;
  marks?: MarksBySide;
  round?: number;
  unavailable?: string | null;
}

/**
 * The hook under the props `Board` gives it, with a rerender that takes the same
 * shape — every staleness case is a rerender with one of them changed.
 */
function setup(over: Setup = {}) {
  const onFire = vi.fn();
  const heldFor = (o: Setup) =>
    heldAbilities(
      o.loadout ?? loadoutWith('rust'),
      o.abilities ?? { rust: { marks: 0, available: true } },
    );
  const props = (o: Setup) => ({
    held: heldFor(o),
    marks: o.marks ?? { own: CLEAR, opponent: { ...CLEAR, scissors: 2 } },
    round: o.round ?? 3,
    unavailable: o.unavailable ?? null,
    onFire,
  });
  const view = renderHook((o: Setup) => useAbilityTargeting(props(o)), {
    initialProps: over,
  });
  const start = (helperId: string) =>
    act(() => {
      view.result.current.start(heldFor(over).find((a) => a.id === helperId)!);
    });
  return {
    ...view,
    onFire,
    start,
    /** Rerender with the original setup plus a change, which is every stale case. */
    change: (next: Setup) => view.rerender({ ...over, ...next }),
  };
}

describe('useAbilityTargeting — the walk (JQ-325)', () => {
  it('opens a one-step card on the side its step names', () => {
    const { result, start } = setup();
    expect(result.current.targeting).toBeNull();
    start('rust');

    const t = result.current.targeting!;
    expect(t.helperId).toBe('rust');
    expect(t.side).toBe('opponent');
    expect(t.instruction).toBe('Choose one of their moves for Rust');
    // The step's own words are kept, not rewritten: they are the only place a
    // player learns whether they hold Quarantine or Tripwire.
    expect(t.prompt).toMatch(/move they have on cooldown/i);
    // Only what `legalTargets` allows — Scissors is the one move they have marked.
    expect(t.legal).toEqual(['scissors']);
    expect(t.rejection('rock')).toMatch(/Rock is clear/i);
    expect(result.current.isTargeting('rust')).toBe(true);
  });

  it('walks Thief across both boards and lands on the confirm step', () => {
    const { result, start } = setup({
      loadout: loadoutWith('thief'),
      abilities: { thief: { marks: 0, available: true } },
      marks: { own: { ...CLEAR, rock: 1 }, opponent: CLEAR },
    });
    start('thief');

    expect(result.current.targeting!.side).toBe('own');
    expect(result.current.targeting!.legal).toEqual(['rock']);
    act(() => result.current.name('rock'));

    // The source is answered, so the board moves to theirs for the target.
    expect(result.current.targeting!.side).toBe('opponent');
    expect(result.current.targeting!.named).toEqual({ source: 'rock' });
    act(() => result.current.name('paper'));

    // Every step answered: no step left, which is the confirm step.
    expect(result.current.targeting!.step).toBeNull();
    expect(result.current.targeting!.named).toEqual({ source: 'rock', target: 'paper' });
  });

  it('opens a targetless card straight on its confirm step', () => {
    const { result, start } = setup({
      loadout: loadoutWith('freeze'),
      abilities: { freeze: { marks: 0, available: true } },
    });
    start('freeze');
    expect(result.current.targeting!.step).toBeNull();
    // Nowhere to point, so the board stays on your own.
    expect(result.current.targeting!.side).toBe('own');
  });
});

describe('useAbilityTargeting — cancel and fire (JQ-325)', () => {
  it('sends nothing when an unsent walk is cancelled, and leaves no note', () => {
    const { result, onFire, start } = setup();
    start('rust');
    act(() => result.current.cancel());
    expect(result.current.targeting).toBeNull();
    expect(onFire).not.toHaveBeenCalled();
    // A cancel the player asked for needs no explanation; only a walk taken away
    // from them does.
    expect(result.current.note).toBeNull();
  });

  it('fires once with the named moves and says so while the echo is in flight', () => {
    const { result, onFire, start } = setup();
    start('rust');
    act(() => result.current.name('scissors'));
    act(() => result.current.confirm());

    expect(onFire).toHaveBeenCalledTimes(1);
    expect(onFire).toHaveBeenCalledWith({
      helperId: 'rust',
      target: 'scissors',
      source: null,
    });
    expect(result.current.targeting).toBeNull();
    expect(result.current.note).toEqual({
      helperId: 'rust',
      kind: 'fired',
      text: 'Rust fired, naming their Scissors.',
    });
  });

  it('names both of Thief\'s moves in the fired line', () => {
    const { result, start } = setup({
      loadout: loadoutWith('thief'),
      abilities: { thief: { marks: 0, available: true } },
      marks: { own: { ...CLEAR, rock: 1 }, opponent: CLEAR },
    });
    start('thief');
    act(() => result.current.name('rock'));
    act(() => result.current.name('paper'));
    act(() => result.current.confirm());
    expect(result.current.note!.text).toBe(
      'Thief fired, taking a mark from your Rock and naming their Paper.',
    );
  });
});

describe('useAbilityTargeting — nothing stale stays actionable (JQ-325, AC #8)', () => {
  it('clears an open walk when the round moves on', () => {
    const { result, onFire, start, change } = setup();
    start('rust');
    act(() => change({ round: 4 }));

    expect(result.current.targeting).toBeNull();
    expect(onFire).not.toHaveBeenCalled();
    expect(result.current.note).toEqual({
      helperId: 'rust',
      kind: 'cancelled',
      text: 'Rust was not fired — the round moved on.',
    });
  });

  it('clears it in the round\'s own words when the round stops taking firings', () => {
    const { result, onFire, start, change } = setup();
    start('rust');
    act(() => change({ unavailable: 'The round is resolving.' }));

    expect(result.current.targeting).toBeNull();
    expect(onFire).not.toHaveBeenCalled();
    // The reason the rail would have given, rather than a second wording of it.
    expect(result.current.note!.text).toBe('Rust was not fired — the round is resolving.');
  });

  it('clears it when the charge stops being firable underneath it', () => {
    const { result, onFire, start, change } = setup();
    start('rust');
    act(() => change({ abilities: { rust: { marks: 0, available: false } } }));

    expect(result.current.targeting).toBeNull();
    expect(onFire).not.toHaveBeenCalled();
    expect(result.current.note!.text).toBe('Rust was not fired — Rust can no longer fire this round.');
  });

  it('clears it when a move already named stops being a legal target', () => {
    const { result, onFire, start, change } = setup({
      loadout: loadoutWith('thief'),
      abilities: { thief: { marks: 0, available: true } },
      marks: { own: { ...CLEAR, rock: 1 }, opponent: CLEAR },
    });
    start('thief');
    act(() => result.current.name('rock'));
    // The mark this firing was going to take is gone, so the source it named is
    // no longer a source.
    act(() => change({ marks: { own: CLEAR, opponent: CLEAR } }));

    expect(result.current.targeting).toBeNull();
    expect(onFire).not.toHaveBeenCalled();
    expect(result.current.note!.text).toBe('Thief was not fired — that target is no longer legal.');
  });

  it('leaves a walk alone on an ordinary refresh', () => {
    const { result, start, change } = setup();
    start('rust');
    act(() => change({}));
    expect(result.current.targeting).not.toBeNull();
    expect(result.current.note).toBeNull();
  });
});

describe('useAbilityTargeting — the note does not outlive its round (JQ-325)', () => {
  it('drops the note when the round moves on', () => {
    const { result, start, change } = setup();
    start('rust');
    act(() => result.current.name('scissors'));
    act(() => result.current.confirm());
    expect(result.current.note).not.toBeNull();

    act(() => change({ round: 4 }));
    expect(result.current.note).toBeNull();
  });

  it('drops the note when a new walk starts', () => {
    const { result, start } = setup({
      loadout: ['rust', 'thief'] as unknown as Loadout,
      abilities: {
        rust: { marks: 0, available: true },
        thief: { marks: 0, available: true },
      },
      marks: { own: { ...CLEAR, rock: 1 }, opponent: { ...CLEAR, scissors: 2 } },
    });
    start('rust');
    act(() => result.current.name('scissors'));
    act(() => result.current.confirm());
    expect(result.current.note).not.toBeNull();

    start('thief');
    expect(result.current.note).toBeNull();
  });
});
