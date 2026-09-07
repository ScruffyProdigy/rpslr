import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import MoveIcon from './MoveIcon';
import { ALL_MOVES } from '../moves';

describe('<MoveIcon> (JQ-97)', () => {
  it('draws every move', () => {
    for (const move of ALL_MOVES) {
      const { container, unmount } = render(<MoveIcon move={move} />);
      expect(container.querySelector(`svg[data-move="${move}"]`)).toBeInTheDocument();
      unmount();
    }
  });

  it('gives each instance its own mask id', () => {
    // The same move is on screen several times at once — a button, the graph,
    // a history chip. Duplicate ids would point every copy at the first one's
    // mask, and in a browser that leaves the later ones blank.
    const { container } = render(
      <>
        <MoveIcon move="rock" />
        <MoveIcon move="rock" />
        <MoveIcon move="paper" />
      </>,
    );
    const ids = [...container.querySelectorAll('mask')].map((m) => m.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    // and each icon points at its own
    for (const svg of container.querySelectorAll('svg')) {
      const maskId = svg.querySelector('mask')!.id;
      expect(svg.querySelector('rect[mask]')!.getAttribute('mask')).toBe(`url(#${maskId})`);
    }
  });

  it('is decorative — every call site already names the move in text', () => {
    const { container } = render(<MoveIcon move="lizard" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('sizes in em by default so it flows with the text around it', () => {
    const { container } = render(<MoveIcon move="robot" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('1em');
    expect(svg.getAttribute('height')).toBe('1em');
  });

  it('takes user units and a position for drawing inside another svg', () => {
    // The how-to-play graph nests these in its own coordinate space.
    const { container } = render(<MoveIcon move="scissors" size={36} x={12} y={20} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('36');
    expect(svg.getAttribute('x')).toBe('12');
    expect(svg.getAttribute('y')).toBe('20');
  });
});
