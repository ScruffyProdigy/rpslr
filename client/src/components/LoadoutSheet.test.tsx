import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Loadout } from '@game/helpers/loadout';
import type { Move, Seat } from '../api';
import { seatLoadoutView } from '../loadouts';
import { LoadoutSheet } from './LoadoutSheet';

const YOU = { profile: null, name: 'Ada', placeholder: false };
const OPP = { profile: null, name: 'Grace', placeholder: false };

function seat(loadout: Loadout | null, loadoutRoll: Move | null = null): Seat {
  return {
    id: 'seat-a',
    matchId: 'm1',
    seatKey: 'a',
    teamKey: null,
    role: null,
    position: 0,
    reservedForLobbyUser: null,
    player: null,
    lobbyProfile: null,
    delays: {},
    loadout,
    loadoutRoll,
  };
}

function sheet(over: {
  open?: boolean;
  variant?: 'reveal' | 'check';
  mine?: Loadout | null;
  theirs?: Loadout | null;
  myRoll?: Move | null;
  onClose?: () => void;
} = {}) {
  const {
    open = true,
    variant = 'reveal',
    mine = ['ferrus', 'echo-chamber'] as Loadout,
    theirs = ['chimera', 'poker-face'] as Loadout,
    myRoll = null,
    onClose = () => {},
  } = over;
  return render(
    <LoadoutSheet
      open={open}
      variant={variant}
      mine={seatLoadoutView(seat(mine, myRoll))}
      theirs={seatLoadoutView(seat(theirs))}
      you={YOU}
      opponent={OPP}
      onClose={onClose}
    />,
  );
}

describe('<LoadoutSheet> (JQ-149)', () => {
  it('shows both loadouts face up, with names, tier and mark cost', () => {
    sheet();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Ferrus')).toBeInTheDocument();
    expect(within(dialog).getByText('Echo Chamber')).toBeInTheDocument();
    expect(within(dialog).getByText('Chimera')).toBeInTheDocument();
    expect(within(dialog).getByText('Poker Face')).toBeInTheDocument();
    // Ferrus and Chimera are both Majors, so the tier line is not unique — and
    // that it is stated per card rather than once per side is the point.
    expect(within(dialog).getAllByText(/Major · 2 marks on/)).toHaveLength(2);
    expect(within(dialog).getByText(/Minor · 1 mark on/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Trinket · free/)).toBeInTheDocument();
  });

  it('names the opponent, so a loadout is attached to the player holding it', () => {
    sheet();
    expect(screen.getByText('Grace')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
  });

  it('says which moves start down and how deep, for both players', () => {
    sheet();
    const sides = screen.getAllByRole('heading', { level: 3 });
    expect(sides).toHaveLength(2);
    // Ferrus + Echo Chamber: Robot on 2, Paper on 1. Chimera + Poker Face: Lizard on 2.
    expect(screen.getAllByLabelText('on cooldown, 2 turns')).toHaveLength(2);
    expect(screen.getAllByLabelText('on cooldown, 1 turn')).toHaveLength(1);
  });

  it('names the move a same-move pairing displaced marks onto', () => {
    sheet({ mine: ['ferrus', 'well-oiled'], myRoll: 'lizard' });
    expect(screen.getByText(/Both helpers bind the same move/)).toHaveTextContent(/Lizard/);
  });

  it('says nothing about a roll where there was no collision', () => {
    sheet();
    expect(screen.queryByText(/Both helpers bind the same move/)).not.toBeInTheDocument();
  });

  it('renders nothing at all for duel, which brings no loadout', () => {
    const { container } = sheet({ mine: null, theirs: null });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while closed', () => {
    const { container } = sheet({ open: false });
    expect(container).toBeEmptyDOMElement();
  });

  it('is skippable — and says what skipping actually does', () => {
    // "Start round 1" would be a promise one tap cannot keep: the phase ends when
    // both seats have read it, or when its deadline runs out.
    const onClose = vi.fn();
    sheet({ onClose });
    fireEvent.click(screen.getByRole('button', { name: "I'm ready" }));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes rather than starting a round when it was the player who asked', () => {
    const onClose = vi.fn();
    sheet({ variant: 'check', onClose });
    expect(screen.queryByText(/chosen before the match was made/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('takes focus on open and hands Escape back to the caller', () => {
    const onClose = vi.fn();
    sheet({ onClose });
    expect(screen.getByRole('button', { name: "I'm ready" })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('dismisses from the backdrop but not from the panel', () => {
    const onClose = vi.fn();
    sheet({ onClose });
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
