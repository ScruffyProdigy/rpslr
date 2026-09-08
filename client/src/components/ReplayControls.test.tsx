import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ReplayControls } from './ReplayControls';

function props(overrides = {}) {
  return {
    playing: true,
    speed: 1 as const,
    stepping: false,
    atStart: false,
    atEnd: false,
    onToggle: vi.fn(),
    onPrev: vi.fn(),
    onNext: vi.fn(),
    onSpeed: vi.fn(),
    ...overrides,
  };
}

describe('<ReplayControls>', () => {
  it('offers pause while playing and play while paused', async () => {
    const p = props();
    const { rerender } = render(<ReplayControls {...p} />);
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(p.onToggle).toHaveBeenCalled();

    rerender(<ReplayControls {...props({ playing: false })} />);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('steps between rounds', async () => {
    const p = props();
    render(<ReplayControls {...p} />);
    await userEvent.click(screen.getByRole('button', { name: 'Previous round' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next round' }));
    expect(p.onPrev).toHaveBeenCalled();
    expect(p.onNext).toHaveBeenCalled();
  });

  it('disables the steps at each end', () => {
    render(<ReplayControls {...props({ atStart: true, atEnd: true })} />);
    expect(screen.getByRole('button', { name: 'Previous round' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next round' })).toBeDisabled();
  });

  it('switches speed and marks the current one', async () => {
    const p = props();
    render(<ReplayControls {...p} />);
    expect(screen.getByRole('button', { name: 'Normal speed' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Double speed' }));
    expect(p.onSpeed).toHaveBeenCalledWith(2);
  });

  it('drops play and speed entirely when the watcher asked for no motion', () => {
    render(<ReplayControls {...props({ stepping: true, playing: false })} />);
    expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Double speed' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next round' })).toBeInTheDocument();
  });
});
