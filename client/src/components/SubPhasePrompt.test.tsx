import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Entitlement } from '@game/types';
import { SubPhasePrompt } from './SubPhasePrompt';

/** An Oracle holder's claim: one reveal, nothing incoming, not yet answered. */
function oracleClaim(over: Partial<Entitlement> = {}): Entitlement {
  return {
    round: 3,
    reveals: [{ helperId: 'oracle', namedMove: 'paper' }],
    incoming: [],
    acted: false,
    ...over,
  };
}

function renderPrompt(
  over: {
    entitlement?: Entitlement | null;
    round?: number;
    myMove?: 'rock' | 'paper' | null;
    onKeep?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const onKeep = over.onKeep ?? vi.fn();
  const utils = render(
    <SubPhasePrompt
      entitlement={'entitlement' in over ? (over.entitlement ?? null) : oracleClaim()}
      round={over.round ?? 3}
      myMove={'myMove' in over ? (over.myMove ?? null) : 'rock'}
      onKeep={onKeep}
    />,
  );
  return { ...utils, onKeep };
}

describe('SubPhasePrompt (JQ-221)', () => {
  it('renders nothing for a seat with no claim on the window', () => {
    const { container } = renderPrompt({ entitlement: null });
    expect(container).toBeEmptyDOMElement();
  });

  /*
   * `Entitlement` carries its own round precisely so this is checkable: a claim
   * that outlived its sub-phase must not reopen the next round's pick.
   */
  it('renders nothing for a claim belonging to an earlier round', () => {
    const { container } = renderPrompt({ entitlement: oracleClaim({ round: 2 }), round: 3 });
    expect(container).toBeEmptyDOMElement();
  });
});

describe('SubPhasePrompt — what your own abilities told you (JQ-221)', () => {
  it('names the ability and the move the opponent did not play', () => {
    renderPrompt();
    expect(screen.getByText(/they did not play/i)).toBeInTheDocument();
    expect(screen.getByText('Oracle')).toBeInTheDocument();
    expect(screen.getByText('Paper')).toBeInTheDocument();
  });

  it('says so when there was nothing to name', () => {
    renderPrompt({
      entitlement: oracleClaim({ reveals: [{ helperId: 'oracle', namedMove: null }] }),
    });
    expect(screen.getByText(/only live move/i)).toBeInTheDocument();
  });

  /*
   * A list, not one card's reveal: JQ-239 generalised the window, and a seat
   * holding two informing abilities is a legal loadout rather than a special case.
   */
  it('renders every reveal, not just the first', () => {
    renderPrompt({
      entitlement: oracleClaim({
        reveals: [
          { helperId: 'oracle', namedMove: 'paper' },
          { helperId: 'quarantine', namedMove: 'lizard' },
        ],
      }),
    });
    expect(screen.getByText('Oracle')).toBeInTheDocument();
    expect(screen.getByText('Quarantine')).toBeInTheDocument();
  });
});

describe('SubPhasePrompt — being fired upon (JQ-221)', () => {
  /*
   * The second way in (JQ-239). No card is `public` today, so this path is
   * unreachable in play — but the entitlement carries it, and a window that
   * appeared with nothing in it would be worse than one that explains itself.
   */
  it('names a public firing aimed at you, and the move it named', () => {
    renderPrompt({
      entitlement: oracleClaim({
        reveals: [],
        incoming: [{ helperId: 'rust', target: 'scissors' }],
      }),
    });
    expect(screen.getByText(/they fired it at you/i)).toBeInTheDocument();
    expect(screen.getByText('Rust')).toBeInTheDocument();
    expect(screen.getByText('Scissors')).toBeInTheDocument();
  });

  /*
   * Never says whether it landed: that turns on the move you committed, and being
   * told "it missed" would hand you something about your own board the firer did
   * not pay for.
   */
  it('never says whether the firing landed', () => {
    renderPrompt({
      entitlement: oracleClaim({ reveals: [], incoming: [{ helperId: 'rust', target: 'scissors' }] }),
    });
    expect(screen.queryByText(/hit|missed|landed/i)).not.toBeInTheDocument();
  });
});

describe('SubPhasePrompt — answering (JQ-221)', () => {
  it('offers to keep the pick you already made, and names it', async () => {
    const user = userEvent.setup();
    const { onKeep } = renderPrompt({ myMove: 'rock' });
    await user.click(screen.getByRole('button', { name: /keep rock/i }));
    expect(onKeep).toHaveBeenCalledWith('rock');
  });

  it('offers no keep button when the pick is not known', () => {
    renderPrompt({ myMove: null });
    expect(screen.queryByRole('button', { name: /keep/i })).not.toBeInTheDocument();
  });

  it('says the clock decides if you do nothing', () => {
    renderPrompt();
    expect(screen.getByText(/if the clock runs out, your pick stands/i)).toBeInTheDocument();
  });

  /*
   * `acted` is written down server-side rather than inferred, because a seat that
   * re-picked the move it already had is indistinguishable from one that has not
   * answered. Offering the window again would invite a second, refusable send.
   */
  it('stops offering the window once this seat has used it', () => {
    renderPrompt({ entitlement: oracleClaim({ acted: true }) });
    expect(screen.queryByRole('button', { name: /keep/i })).not.toBeInTheDocument();
    expect(screen.getByText(/your answer is in/i)).toBeInTheDocument();
    // The reveal stays on screen — it is what you paid for.
    expect(screen.getByText(/they did not play/i)).toBeInTheDocument();
  });
});
