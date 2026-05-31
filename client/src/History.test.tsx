import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { History } from './App';
import type { RoundResult } from './api';

const results: RoundResult[] = [
  { round: 1, outcome: 'a', moves: {} },
  { round: 2, outcome: 'draw', moves: {} },
  { round: 3, outcome: 'b', moves: {} },
];

describe('<History>', () => {
  it('renders a verdict per round relative to the viewer seat key', () => {
    render(<History results={results} mySeatKey="a" />);
    expect(screen.getByText('Round history')).toBeInTheDocument();
    expect(screen.getByText('You won')).toBeInTheDocument();
    expect(screen.getByText('You lost')).toBeInTheDocument();
    expect(screen.getByText('Draw')).toBeInTheDocument();
  });

  it('flips win/loss for the opponent seat', () => {
    render(<History results={[{ round: 1, outcome: 'a', moves: {} }]} mySeatKey="b" />);
    expect(screen.getByText('You lost')).toBeInTheDocument();
  });

  it('renders nothing when there are no results', () => {
    const { container } = render(<History results={[]} mySeatKey="a" />);
    expect(container).toBeEmptyDOMElement();
  });
});
