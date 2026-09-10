import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OraclePrompt } from './OraclePrompt';

function renderPrompt(
  over: {
    reveal?: { round: number; namedMove: 'rock' | 'paper' | null } | null;
    round?: number;
    myMove?: 'rock' | 'paper' | null;
    onKeep?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const onKeep = over.onKeep ?? vi.fn();
  const utils = render(
    <OraclePrompt
      reveal={'reveal' in over ? (over.reveal ?? null) : { round: 3, namedMove: 'paper' }}
      round={over.round ?? 3}
      myMove={'myMove' in over ? (over.myMove ?? null) : 'rock'}
      onKeep={onKeep}
    />,
  );
  return { ...utils, onKeep };
}

describe('OraclePrompt (JQ-221)', () => {
  it('renders nothing when no reveal is running', () => {
    const { container } = renderPrompt({ reveal: null });
    expect(container).toBeEmptyDOMElement();
  });

  /*
   * `OracleReveal` carries its own round precisely so this is checkable: a reveal
   * that outlived its sub-phase must not be rendered against the next round's
   * pick, where it would name a move about a round nobody is playing.
   */
  it('renders nothing for a reveal belonging to an earlier round', () => {
    const { container } = renderPrompt({ reveal: { round: 2, namedMove: 'paper' }, round: 3 });
    expect(container).toBeEmptyDOMElement();
  });

  it('names the move the opponent did not play', () => {
    renderPrompt();
    expect(screen.getByText(/they did not play/i)).toBeInTheDocument();
    expect(screen.getByText('Paper')).toBeInTheDocument();
  });

  /*
   * Null when the opponent played their only live move — there was nothing they
   * did not play. The charge is spent either way, so the prompt still appears and
   * says what happened rather than vanishing as if nothing had.
   */
  it('says so when there was nothing to name', () => {
    renderPrompt({ reveal: { round: 3, namedMove: null } });
    expect(screen.getByText(/only live move/i)).toBeInTheDocument();
  });

  it('offers to keep the pick you already made, and names it', async () => {
    const user = userEvent.setup();
    const { onKeep } = renderPrompt({ myMove: 'rock' });
    const keep = screen.getByRole('button', { name: /keep rock/i });
    await user.click(keep);
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
});
