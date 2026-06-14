import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { History } from './App';
import type { RoundResult } from './api';

const PLAYER_A = 'player-a';
const PLAYER_B = 'player-b';

const results: RoundResult[] = [
  {
    round: 1,
    outcome: 'a',
    moves: { [PLAYER_A]: 'paper', [PLAYER_B]: 'robot' },
  },
  {
    round: 2,
    outcome: 'draw',
    moves: { [PLAYER_A]: 'rock', [PLAYER_B]: 'rock' },
  },
  {
    round: 3,
    outcome: 'b',
    moves: { [PLAYER_A]: 'scissors', [PLAYER_B]: 'rock' },
  },
];

describe('<History>', () => {
  it('renders a verdict per round relative to the viewer seat key', () => {
    render(<History results={results} mySeatKey="a" myPlayerId={PLAYER_A} />);
    expect(screen.getByText('Round history')).toBeInTheDocument();
    expect(screen.getByText('You won')).toBeInTheDocument();
    expect(screen.getByText('You lost')).toBeInTheDocument();
    expect(screen.getByText('Draw')).toBeInTheDocument();
  });

  it('shows each side’s move and the beat phrase', () => {
    render(<History results={results} mySeatKey="a" myPlayerId={PLAYER_A} />);
    expect(screen.getByText('Paper disproves Robot')).toBeInTheDocument();
    expect(screen.getByText(/You .* Paper/)).toBeInTheDocument();
    expect(screen.getByText(/Opponent .* Robot/)).toBeInTheDocument();
    expect(screen.getByText(/Rock vs Rock — same pick, no winner/)).toBeInTheDocument();
    expect(screen.getByText('Rock crushes Scissors')).toBeInTheDocument();
  });

  it('flips win/loss for the opponent seat', () => {
    render(
      <History
        results={[{ round: 1, outcome: 'a', moves: { [PLAYER_A]: 'paper', [PLAYER_B]: 'robot' } }]}
        mySeatKey="b"
        myPlayerId={PLAYER_B}
      />,
    );
    expect(screen.getByText('You lost')).toBeInTheDocument();
    expect(screen.getByText(/You .* Robot/)).toBeInTheDocument();
    expect(screen.getByText(/Opponent .* Paper/)).toBeInTheDocument();
  });

  it('renders nothing when there are no results', () => {
    const { container } = render(<History results={[]} mySeatKey="a" myPlayerId={PLAYER_A} />);
    expect(container).toBeEmptyDOMElement();
  });
});
