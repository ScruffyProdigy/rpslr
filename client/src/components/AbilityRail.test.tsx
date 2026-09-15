import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AbilityMap } from '@game/helpers/abilities';
import type { Loadout } from '@game/helpers/loadout';
import { getHelper } from '@game/helpers/roster';
import { heldAbilities } from '../abilities';
import type { AbilityTargeting, TargetingNote } from '../lib/useAbilityTargeting';
import { AbilityRail } from './AbilityRail';

function loadoutWith(majorId: string): Loadout {
  return [majorId, 'echo-chamber'] as unknown as Loadout;
}

/**
 * A stand-in for the walk.
 *
 * The walk itself is `useAbilityTargeting`'s and is tested there; what the rail
 * owes is that it reads this correctly — which card is naming, whose note is
 * whose, and that pressing Fire hands over the card rather than a firing.
 */
function stubTargeting(over: Partial<AbilityTargeting> = {}): AbilityTargeting {
  return {
    targeting: null,
    note: null,
    isTargeting: () => false,
    start: vi.fn(),
    name: vi.fn(),
    cancel: vi.fn(),
    confirm: vi.fn(),
    ...over,
  };
}

function renderRail(
  over: {
    loadout?: Loadout | null;
    abilities?: AbilityMap;
    unavailable?: string | null;
    targeting?: AbilityTargeting;
  } = {},
) {
  const targeting = over.targeting ?? stubTargeting();
  const utils = render(
    <AbilityRail
      held={heldAbilities(
        // `??` would swallow an explicit null, which is the duel case this file
        // most needs to reach.
        'loadout' in over ? (over.loadout ?? null) : loadoutWith('rust'),
        over.abilities ?? { rust: { marks: 0, available: true } },
      )}
      unavailable={over.unavailable ?? null}
      targeting={targeting}
    />,
  );
  return { ...utils, targeting };
}

/** The card for one ability, found by its accessible group name. */
function card(name: string): HTMLElement {
  return screen.getByRole('group', { name: new RegExp(name, 'i') });
}

describe('AbilityRail — presence (JQ-221)', () => {
  /*
   * AC #7. `duel` brings the null loadout, so the charge map is empty, so there
   * must be no rail at all — not an empty one. An empty container is a layout
   * shift on a board that is meant to render exactly as it does today.
   */
  it('renders nothing at all for a seat holding no abilities', () => {
    const { container } = renderRail({ loadout: null, abilities: {} });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the Major is a passive', () => {
    const { container } = renderRail({ loadout: loadoutWith('chimera'), abilities: {} });
    expect(container).toBeEmptyDOMElement();
  });

  it('names the card and its blurb from the roster', () => {
    renderRail();
    // From the roster, not repeated here — see the note in abilities.test.ts.
    expect(within(card('Rust')).getByText(getHelper('rust')!.blurb)).toBeInTheDocument();
  });
});

describe('AbilityRail — whose cards these are (JQ-325, AC #9)', () => {
  /*
   * The rail sits below a board that may be showing the opponent. Nothing about
   * it changes when the tab does — it lives outside the tab panel — but an
   * unlabelled row of cards under their pentagon can still read as theirs.
   */
  it('says whose abilities the rail holds', () => {
    renderRail();
    expect(screen.getByRole('region', { name: 'Your abilities' })).toBeInTheDocument();
  });

  it('puts the same possessive on each card, where a screen reader lands', () => {
    renderRail();
    expect(screen.getByRole('group', { name: 'Your Rust — Ready' })).toBeInTheDocument();
  });
});

describe('AbilityRail — charge state (JQ-221)', () => {
  /*
   * AC #5, JQ-195's rule: the three states must be told apart without colour. Each
   * carries a word, and the word is asserted here rather than a class name.
   */
  it('says "Ready" and offers the button when the charge is up', () => {
    renderRail();
    expect(within(card('Rust')).getByText('Ready')).toBeInTheDocument();
    expect(within(card('Rust')).getByRole('button', { name: /fire rust/i })).toBeEnabled();
  });

  it('counts the rounds left while recharging, and offers no button', () => {
    renderRail({ abilities: { rust: { marks: 2, available: false } } });
    expect(within(card('Rust')).getByText('2 more rounds')).toBeInTheDocument();
    expect(within(card('Rust')).getByRole('button', { name: /fire rust/i })).toBeDisabled();
  });

  it('says "Spent" for a charge that is gone for the match', () => {
    renderRail({ abilities: { rust: { marks: null, available: false } } });
    expect(within(card('Rust')).getByText('Spent')).toBeInTheDocument();
    expect(within(card('Rust')).getByRole('button', { name: /fire rust/i })).toBeDisabled();
  });

  /*
   * Charged but unavailable is the server saying "this one already fired this
   * round". Per ability, not per seat: JQ-238 made the rule one firing per slot,
   * so the *other* card stays firable — which the next test holds.
   */
  it('keeps the charge word but blocks the button once this ability has fired', () => {
    renderRail({ abilities: { rust: { marks: 0, available: false } } });
    expect(within(card('Rust')).getByText('Ready')).toBeInTheDocument();
    const button = within(card('Rust')).getByRole('button', { name: /fire rust/i });
    expect(button).toBeDisabled();
    expect(within(card('Rust')).getByText(/already fired Rust this round/i)).toBeInTheDocument();
  });

  it('leaves the other slot firable when one of two abilities has fired (JQ-238)', () => {
    renderRail({
      loadout: ['rust', 'thief'] as unknown as Loadout,
      abilities: {
        rust: { marks: 0, available: false },
        thief: { marks: 0, available: true },
      },
    });
    expect(within(card('Rust')).getByRole('button', { name: /fire rust/i })).toBeDisabled();
    expect(within(card('Thief')).getByRole('button', { name: /fire thief/i })).toBeEnabled();
  });

  /*
   * The round's reason, in the round's words. A boolean here once told a player
   * mid-Oracle that they were reconnecting — wrong, and nothing they could act on.
   */
  it("blocks firing for the round's own reason, and says that reason", () => {
    renderRail({ unavailable: 'The round is resolving.' });
    expect(within(card('Rust')).getByRole('button', { name: /fire rust/i })).toBeDisabled();
    expect(within(card('Rust')).getByText('The round is resolving.')).toBeInTheDocument();
    expect(within(card('Rust')).queryByText(/reconnecting/i)).not.toBeInTheDocument();
  });
});

describe('AbilityRail — handing the walk to the board (JQ-325)', () => {
  /*
   * AC #1. The rail starts a firing and stops there: the naming happens on the
   * pentagon now, so pressing Fire hands over the card rather than a choice.
   */
  it('hands the card over rather than firing it', async () => {
    const user = userEvent.setup();
    const targeting = stubTargeting();
    renderRail({ targeting });
    await user.click(within(card('Rust')).getByRole('button', { name: /fire rust/i }));
    expect(targeting.start).toHaveBeenCalledTimes(1);
    expect(targeting.start).toHaveBeenCalledWith(expect.objectContaining({ id: 'rust' }));
  });

  it('replaces the button with a line pointing at the board while naming', () => {
    renderRail({ targeting: stubTargeting({ isTargeting: (id) => id === 'rust' }) });
    expect(within(card('Rust')).getByText('Naming a target on the board')).toBeInTheDocument();
    expect(
      within(card('Rust')).queryByRole('button', { name: /fire rust/i }),
    ).not.toBeInTheDocument();
  });

  it('leaves the other card alone while one is naming', () => {
    renderRail({
      loadout: ['rust', 'thief'] as unknown as Loadout,
      abilities: {
        rust: { marks: 0, available: true },
        thief: { marks: 0, available: true },
      },
      targeting: stubTargeting({ isTargeting: (id) => id === 'rust' }),
    });
    expect(within(card('Thief')).getByRole('button', { name: /fire thief/i })).toBeEnabled();
  });
});

describe('AbilityRail — what became of a walk (JQ-325)', () => {
  const note = (over: Partial<TargetingNote>): TargetingNote => ({
    helperId: 'rust',
    kind: 'fired',
    text: 'Rust fired, naming their Scissors.',
    ...over,
  });

  /*
   * AC #6. A firing is sent the moment it is confirmed and the server's own map
   * catches up a round-trip later; without this the card goes blank for that gap,
   * straight after the one action in the game that cannot be taken back.
   */
  it('says what was fired while the server echo is still in flight', () => {
    renderRail({ targeting: stubTargeting({ note: note({}) }) });
    expect(within(card('Rust')).getByText('Rust fired, naming their Scissors.')).toBeInTheDocument();
  });

  it('keeps saying it once the echo lands, instead of the vaguer line', () => {
    renderRail({
      abilities: { rust: { marks: 0, available: false } },
      targeting: stubTargeting({ note: note({}) }),
    });
    expect(within(card('Rust')).getByText('Rust fired, naming their Scissors.')).toBeInTheDocument();
    // The same fact, said with less in it. One line, not two — the rail's height
    // is measured, and this one is the more specific.
    expect(
      within(card('Rust')).queryByText(/already fired Rust this round/i),
    ).not.toBeInTheDocument();
  });

  /*
   * AC #8. A walk taken away from the player is explained rather than simply
   * gone, and nothing is submitted in its place.
   */
  it('names the reason a walk was taken away', () => {
    renderRail({
      unavailable: 'The round is resolving.',
      targeting: stubTargeting({
        note: note({ kind: 'cancelled', text: 'Rust was not fired — the round is resolving.' }),
      }),
    });
    expect(
      within(card('Rust')).getByText('Rust was not fired — the round is resolving.'),
    ).toBeInTheDocument();
  });

  it("puts a note on its own card and not on its slot-mate's", () => {
    renderRail({
      loadout: ['rust', 'thief'] as unknown as Loadout,
      abilities: {
        rust: { marks: 0, available: false },
        thief: { marks: 0, available: true },
      },
      targeting: stubTargeting({ note: note({}) }),
    });
    expect(within(card('Rust')).getByText(/Rust fired/)).toBeInTheDocument();
    expect(within(card('Thief')).queryByText(/Rust fired/)).not.toBeInTheDocument();
  });
});
