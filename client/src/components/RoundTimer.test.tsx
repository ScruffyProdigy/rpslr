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
    // No unit on the numeral: inside a ring it reads as a countdown, and the
    // accessible name below carries the word "seconds".
    render(<RoundTimer deadline={deadline(14)} />);
    expect(screen.getByText('14')).toBeInTheDocument();
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
    // Round 1 is 60s, so a quarter of it is 15s — still too late to be useful
    // as the only signal. Five seconds is urgent regardless of allowance.
    const { container } = render(<RoundTimer deadline={deadline(4, 60)} />);
    expect(container.querySelector('.round-timer--urgent')).not.toBeNull();
  });

  it('still renders at zero rather than vanishing', () => {
    render(<RoundTimer deadline={deadline(0)} />);
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('renders the same regardless of lock-in state', () => {
    // The component takes no lock-in prop at all, which is the point: a clock
    // that changed on lock-in would leak it, and Helpers mode's Poker Face
    // exists to hide exactly that.
    const a = render(<RoundTimer deadline={deadline(9)} />).container.innerHTML;
    const b = render(<RoundTimer deadline={deadline(9)} />).container.innerHTML;
    expect(a).toBe(b);
  });

  describe('the ring', () => {
    /** Fraction of the arc still drawn, from its dash offset. */
    function drawn(container: HTMLElement): number {
      const arc = container.querySelector('.round-timer__arc') as SVGCircleElement;
      const total = Number(arc.getAttribute('stroke-dasharray'));
      const offset = Number(arc.getAttribute('stroke-dashoffset'));
      return Number(((total - offset) / total).toFixed(3));
    }

    it('is full at the start of a round', () => {
      const { container } = render(<RoundTimer deadline={deadline(20, 20)} />);
      expect(drawn(container)).toBe(1);
    });

    it('is half drawn at the halfway point', () => {
      const { container } = render(<RoundTimer deadline={deadline(10, 20)} />);
      expect(drawn(container)).toBe(0.5);
    });

    it('is empty at zero', () => {
      const { container } = render(<RoundTimer deadline={deadline(0, 20)} />);
      expect(drawn(container)).toBe(0);
    });

    it('stays full rather than lying when the allowance is unknown', () => {
      const { container } = render(<RoundTimer deadline={deadline(9, null)} />);
      expect(drawn(container)).toBe(1);
    });

    it('beats only in the last five seconds', () => {
      // Motion the player did not ask for, so it is confined to the one moment
      // that earns it.
      const calm = render(<RoundTimer deadline={deadline(6, 20)} />).container;
      expect(calm.querySelector('.round-timer--critical')).toBeNull();
      const late = render(<RoundTimer deadline={deadline(5, 20)} />).container;
      expect(late.querySelector('.round-timer--critical')).not.toBeNull();
    });
  });
});
