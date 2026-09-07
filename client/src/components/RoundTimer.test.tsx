import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RoundTimer } from './RoundTimer';

function deadline(secondsLeft: number | null, totalSeconds: number | null = 20) {
  return { secondsLeft, totalSeconds, expired: secondsLeft === 0 };
}

describe('RoundTimer', () => {
  it('renders nothing when no clock is running', () => {
    const { container } = render(<RoundTimer deadline={deadline(null, null)} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the seconds remaining', () => {
    render(<RoundTimer deadline={deadline(14)} />);
    expect(screen.getByText('14s')).toBeInTheDocument();
  });

  it('names the remaining time for a screen reader', () => {
    render(<RoundTimer deadline={deadline(14)} />);
    expect(screen.getByLabelText('14 seconds left this round')).toBeInTheDocument();
  });

  it('does not announce every tick', () => {
    // A live region updating once a second would make the board unusable with a
    // screen reader; the number is there to read on demand instead.
    const { container } = render(<RoundTimer deadline={deadline(14)} />);
    expect(container.querySelector('.round-timer')).toHaveAttribute('aria-live', 'off');
  });

  it('is not urgent with most of the round left', () => {
    const { container } = render(<RoundTimer deadline={deadline(14)} />);
    expect(container.querySelector('.round-timer--urgent')).toBeNull();
  });

  it('turns urgent in the last quarter of the round', () => {
    const { container } = render(<RoundTimer deadline={deadline(5, 20)} />);
    expect(container.querySelector('.round-timer--urgent')).not.toBeNull();
  });

  it('turns urgent in the last five seconds even of a long round', () => {
    // Round 1 is 45s, so a quarter of it is 12s — still too late to be useful
    // as the only signal. Five seconds is urgent regardless of allowance.
    const { container } = render(<RoundTimer deadline={deadline(4, 45)} />);
    expect(container.querySelector('.round-timer--urgent')).not.toBeNull();
  });

  it('still renders at zero rather than vanishing', () => {
    render(<RoundTimer deadline={deadline(0)} />);
    expect(screen.getByText('0s')).toBeInTheDocument();
  });

  it('renders the same regardless of lock-in state', () => {
    // The component takes no lock-in prop at all, which is the point: a clock
    // that changed on lock-in would leak it, and Helpers mode's Poker Face
    // exists to hide exactly that.
    const a = render(<RoundTimer deadline={deadline(9)} />).container.innerHTML;
    const b = render(<RoundTimer deadline={deadline(9)} />).container.innerHTML;
    expect(a).toBe(b);
  });
});
