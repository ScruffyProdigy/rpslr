import { render, screen } from '@testing-library/react';
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
