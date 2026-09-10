import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AbilityMap } from '@game/helpers/abilities';
import type { Loadout } from '@game/helpers/loadout';
import { getHelper } from '@game/helpers/roster';
import { AbilityRail } from './AbilityRail';

const CLEAR = { rock: 0, paper: 0, scissors: 0, lizard: 0, robot: 0 };

function loadoutWith(majorId: string): Loadout {
  return [majorId, 'echo-chamber'] as unknown as Loadout;
}

function renderRail(
  over: {
    loadout?: Loadout | null;
    abilities?: AbilityMap;
    myMarks?: Record<string, number>;
    oppMarks?: Record<string, number>;
    unavailable?: string | null;
    onFire?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const onFire = over.onFire ?? vi.fn();
  const utils = render(
    <AbilityRail
      // `??` would swallow an explicit null, which is the duel case this file
      // most needs to reach.
      loadout={'loadout' in over ? (over.loadout ?? null) : loadoutWith('rust')}
      abilities={over.abilities ?? { rust: { marks: 0, available: true } }}
      myMarks={over.myMarks ?? CLEAR}
      oppMarks={over.oppMarks ?? { ...CLEAR, scissors: 2 }}
      unavailable={over.unavailable ?? null}
      onFire={onFire}
    />,
  );
  return { ...utils, onFire };
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
    expect(within(card('Rust')).getByText(getHelper('rust')!.blurb))
      .toBeInTheDocument();
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
});

describe('AbilityRail — naming a target (JQ-221)', () => {
  /*
   * AC #2. Rust needs a move they have on cooldown; every other chip must be
   * unclickable rather than merely discouraged.
   */
  it('offers only legal targets, and an illegal one cannot be submitted', async () => {
    const user = userEvent.setup();
    const { onFire } = renderRail({ oppMarks: { ...CLEAR, scissors: 2 } });
    await user.click(within(card('Rust')).getByRole('button', { name: /fire rust/i }));

    const scissors = screen.getByRole('button', { name: /^scissors/i });
    const rock = screen.getByRole('button', { name: /^rock/i });
    expect(scissors).toBeEnabled();
    expect(rock).toBeDisabled();
    expect(rock).toHaveAccessibleDescription(
      /Rock is clear — Rust needs a move they have on cooldown/i,
    );

    await user.click(rock);
    expect(onFire).not.toHaveBeenCalled();
  });

  it('walks Thief through a source and then a target', async () => {
    const user = userEvent.setup();
    const { onFire } = renderRail({
      loadout: loadoutWith('thief'),
      abilities: { thief: { marks: 0, available: true } },
      myMarks: { ...CLEAR, rock: 1 },
      oppMarks: CLEAR,
    });
    await user.click(within(card('Thief')).getByRole('button', { name: /fire thief/i }));

    expect(screen.getByText(/take a mark from one of your moves/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^paper/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /^rock/i }));

    expect(screen.getByText(/put it on one of theirs/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^paper/i }));

    await user.click(screen.getByRole('button', { name: /^fire$/i }));
    expect(onFire).toHaveBeenCalledWith({ helperId: 'thief', source: 'rock', target: 'paper' });
  });
});

describe('AbilityRail — the confirm step (JQ-221)', () => {
  /*
   * AC #3. JQ-220 settled it: a firing is final, there is no withdraw message, so
   * the confirm step has to say so in words rather than imply it.
   */
  it('says plainly that a fired charge does not come back', async () => {
    const user = userEvent.setup();
    renderRail({
      loadout: loadoutWith('freeze'),
      abilities: { freeze: { marks: 0, available: true } },
    });
    await user.click(within(card('Freeze')).getByRole('button', { name: /fire freeze/i }));
    expect(screen.getByText(/can't be taken back/i)).toBeInTheDocument();
    expect(screen.getByText(/spent whether or not it lands/i)).toBeInTheDocument();
  });

  it('sends nothing when the unsent firing is cancelled', async () => {
    const user = userEvent.setup();
    const { onFire } = renderRail({
      loadout: loadoutWith('freeze'),
      abilities: { freeze: { marks: 0, available: true } },
    });
    await user.click(within(card('Freeze')).getByRole('button', { name: /fire freeze/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onFire).not.toHaveBeenCalled();
    expect(screen.queryByText(/can't be taken back/i)).not.toBeInTheDocument();
  });

  it('fires a targetless ability once', async () => {
    const user = userEvent.setup();
    const { onFire } = renderRail({
      loadout: loadoutWith('freeze'),
      abilities: { freeze: { marks: 0, available: true } },
    });
    await user.click(within(card('Freeze')).getByRole('button', { name: /fire freeze/i }));
    await user.click(screen.getByRole('button', { name: /^fire$/i }));
    expect(onFire).toHaveBeenCalledTimes(1);
    expect(onFire).toHaveBeenCalledWith({ helperId: 'freeze', source: null, target: null });
  });

  /*
   * Firing needs the socket or the REST route; with neither there is nothing to
   * send, and a button that silently does nothing is worse than one that says why.
   */
  /*
   * The round's reason, in the round's words. A boolean here once told a player
   * mid-Oracle that they were reconnecting — wrong, and nothing they could act on.
   */
  it('blocks firing for the round\'s own reason, and says that reason', () => {
    renderRail({ unavailable: 'The round is resolving.' });
    expect(within(card('Rust')).getByRole('button', { name: /fire rust/i })).toBeDisabled();
    expect(within(card('Rust')).getByText('The round is resolving.')).toBeInTheDocument();
    expect(within(card('Rust')).queryByText(/reconnecting/i)).not.toBeInTheDocument();
  });
});
