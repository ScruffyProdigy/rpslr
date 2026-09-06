import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ClaimScreen } from './App';

describe('<ClaimScreen> (JQ-99)', () => {
  it('shows the wordmark and a spinner while the claim is in flight', () => {
    const { container } = render(<ClaimScreen error={null} lobbyReturnUrl="https://lobby.test/m" />);
    expect(screen.getByText('Rock Paper Scissors Lizard Robot')).toBeInTheDocument();
    expect(container.querySelector('.spinner')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Joining your match…');
  });

  it('shows a claim failure inline with a way back to the Lobby', () => {
    const { container } = render(
      <ClaimScreen error="seat already taken" lobbyReturnUrl="https://lobby.test/m" />,
    );
    expect(screen.getByText('seat already taken')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to Lobby/ })).toHaveAttribute(
      'href',
      'https://lobby.test/m',
    );
    expect(container.querySelector('.spinner')).not.toBeInTheDocument();
  });

  it('omits the Lobby link when no return URL is known', () => {
    render(<ClaimScreen error="invalid lobby token" lobbyReturnUrl={null} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
