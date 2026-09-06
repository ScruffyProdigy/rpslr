import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HowToPlayGraph } from './HowToPlayGraph';
import { CIRCLE_ORDER } from '../lib/pentagon';
import { describeBeatsOf } from '../moves';

/** jsdom has no matchMedia; the component treats its absence as "no preference". */
function setReducedMotion(reduce: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

afterEach(() => {
  vi.useRealTimers();
  // @ts-expect-error — put jsdom back the way we found it.
  delete window.matchMedia;
});

describe('<HowToPlayGraph>', () => {
  it('opens on Rock with its two outgoing arrows and nothing else', () => {
    const { container } = render(<HowToPlayGraph />);
    expect(screen.getByRole('status')).toHaveTextContent(describeBeatsOf('rock'));
    // Two arrows, not the board's ten: that is the whole point of the panel.
    expect(container.querySelectorAll('.htp-graph__arrow')).toHaveLength(2);
    expect(container.querySelectorAll('.htp-graph__node--active')).toHaveLength(1);
    expect(container.querySelectorAll('.htp-graph__node--target')).toHaveLength(2);
  });

  it('draws all five nodes at every step', () => {
    const { container } = render(<HowToPlayGraph />);
    expect(container.querySelectorAll('.htp-graph__node')).toHaveLength(5);
  });

  it('steps through every move with the right verb line', () => {
    vi.useFakeTimers();
    render(<HowToPlayGraph />);
    for (const move of CIRCLE_ORDER) {
      expect(screen.getByRole('status')).toHaveTextContent(describeBeatsOf(move));
      act(() => {
        vi.advanceTimersByTime(2500);
      });
    }
    // Wrapped back to the start.
    expect(screen.getByRole('status')).toHaveTextContent(describeBeatsOf(CIRCLE_ORDER[0]));
  });

  it('jumps to a move when its dot is tapped, and stops auto-advancing', async () => {
    const user = userEvent.setup();
    render(<HowToPlayGraph />);
    await user.click(screen.getByRole('button', { name: 'Show what Paper beats' }));
    expect(screen.getByRole('status')).toHaveTextContent(describeBeatsOf('paper'));

    // Reading at your own pace means the graph stops moving under you.
    vi.useFakeTimers();
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.getByRole('status')).toHaveTextContent(describeBeatsOf('paper'));
  });
});

describe('<HowToPlayGraph> reduced motion', () => {
  beforeEach(() => setReducedMotion(true));

  it('does not auto-advance', () => {
    vi.useFakeTimers();
    render(<HowToPlayGraph />);
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.getByRole('status')).toHaveTextContent(describeBeatsOf('rock'));
  });

  it('still lets the dots step through the moves', async () => {
    const user = userEvent.setup();
    render(<HowToPlayGraph />);
    await user.click(screen.getByRole('button', { name: 'Show what Robot beats' }));
    expect(screen.getByRole('status')).toHaveTextContent(describeBeatsOf('robot'));
  });
});
