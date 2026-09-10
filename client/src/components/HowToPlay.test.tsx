import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HowToPlay, HowToPlayDialog } from './HowToPlay';

describe('<HowToPlay>', () => {
  it('teaches the graph, the cooldowns and the win condition', () => {
    render(<HowToPlay bestOf={5} />);
    expect(screen.getByRole('heading', { name: 'What beats what' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cooldowns' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'First to 3' })).toBeInTheDocument();
  });

  it('counts the win condition off bestOf rather than hardcoding it', () => {
    render(<HowToPlay bestOf={7} />);
    expect(screen.getByRole('heading', { name: 'First to 4' })).toBeInTheDocument();
    expect(screen.getByText(/Win 4 rounds/)).toBeInTheDocument();
  });

  it('tells the player where a match of nothing but draws stops', () => {
    render(<HowToPlay bestOf={5} />);
    expect(screen.getByText(/10 rounds/)).toBeInTheDocument();
  });
});

describe('<HowToPlayDialog>', () => {
  it('renders nothing readable until it is opened', () => {
    render(<HowToPlayDialog bestOf={5} open={false} onClose={() => {}} />);
    expect(screen.queryByRole('heading', { name: 'What beats what' })).not.toBeInTheDocument();
  });

  it('shows the panels when open', () => {
    render(<HowToPlayDialog bestOf={5} open onClose={() => {}} />);
    expect(screen.getByRole('heading', { name: 'What beats what' })).toBeInTheDocument();
  });

  it('closes on the close button', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<HowToPlayDialog bestOf={5} open onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on a backdrop tap, but not on a tap inside the panel', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(<HowToPlayDialog bestOf={5} open onClose={onClose} />);
    await user.click(container.querySelector('.htp-dialog__inner') as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
    await user.click(container.querySelector('.htp-dialog') as HTMLElement);
    expect(onClose).toHaveBeenCalled();
  });

  it('holds the only copy of its open state', () => {
    // The `?` button dies for the rest of the match if the modal can close
    // without React hearing about it, so there is no DOM state to drift.
    const { container } = render(<HowToPlayDialog bestOf={5} open={false} onClose={() => {}} />);
    expect(container.querySelector('.htp-dialog')).not.toBeInTheDocument();
  });

  it('puts focus somewhere useful when it opens', () => {
    render(<HowToPlayDialog bestOf={5} open onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<HowToPlayDialog bestOf={5} open onClose={onClose} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});

/*
 * The modal was built on native `<dialog>`, which gives a focus trap and an
 * inert background for free, then rebuilt as a plain overlay because `<dialog>`
 * fires no close/cancel event in the in-app browser. `aria-modal` already asks
 * assistive tech to treat the background as inert; the keyboard is what was
 * left owing (JQ-157).
 */
describe('<HowToPlayDialog> keeps the keyboard inside it (JQ-157)', () => {
  function panelControls(container: HTMLElement): HTMLElement[] {
    const panel = container.querySelector('.htp-dialog__inner') as HTMLElement;
    return within(panel).getAllByRole('button');
  }

  it('never lets Tab reach the content behind it', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <>
        <button>behind</button>
        <HowToPlayDialog bestOf={5} open onClose={() => {}} />
      </>,
    );
    const behind = screen.getByRole('button', { name: 'behind' });
    // More tabs than the panel has controls, so a leak has to show up.
    for (let i = 0; i < panelControls(container).length * 2 + 2; i++) {
      await user.tab();
      expect(behind).not.toHaveFocus();
    }
  });

  it('wraps backwards from the first control to the last', async () => {
    const user = userEvent.setup();
    const { container } = render(<HowToPlayDialog bestOf={5} open onClose={() => {}} />);
    const controls = panelControls(container);
    expect(controls[0]).toHaveFocus();
    await user.tab({ shift: true });
    expect(controls[controls.length - 1]).toHaveFocus();
  });

  it('gives focus back to the control that opened it', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>How to play</button>
          <HowToPlayDialog bestOf={5} open={open} onClose={() => setOpen(false)} />
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'How to play' });
    await user.click(opener);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(opener).toHaveFocus();
  });

  it('does not pull focus back to Close when the match re-renders', async () => {
    // `onClose` is rebuilt on every render by useFirstMatchRules, so an effect
    // that depends on it re-runs — and re-focuses — on every clock tick, which
    // would make the panel unreadable with a keyboard.
    const user = userEvent.setup();
    const { rerender } = render(<HowToPlayDialog bestOf={5} open onClose={() => {}} />);
    await user.tab();
    const moved = document.activeElement;
    expect(moved).not.toBe(screen.getByRole('button', { name: 'Close' }));
    rerender(<HowToPlayDialog bestOf={5} open onClose={() => {}} />);
    expect(document.activeElement).toBe(moved);
  });
});
