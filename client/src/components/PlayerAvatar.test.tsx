import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PlayerAvatar } from './PlayerAvatar';

describe('<PlayerAvatar> fallbacks (JQ 3.5)', () => {
  it('falls back to an initial when the Lobby sent no avatar', () => {
    render(<PlayerAvatar profile={null} displayName="Grace" />);
    expect(screen.getByText('G')).toBeInTheDocument();
  });

  // Three Lobby avatar sources and none is guaranteed to resolve.
  it('falls back to the initial when the image fails to load', () => {
    const { container } = render(
      <PlayerAvatar profile={{ avatarUrl: 'https://example.test/gone.png' }} displayName="Grace" />,
    );
    const img = container.querySelector('img') as HTMLImageElement;
    fireEvent.error(img);
    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(screen.getByText('G')).toBeInTheDocument();
  });

  it('renders an empty disc for a reserved seat with no identity yet', () => {
    const { container } = render(
      <PlayerAvatar profile={null} displayName="Opponent" placeholder />,
    );
    expect(container.querySelector('.player-avatar')).toBeInTheDocument();
    expect(screen.queryByText('O')).not.toBeInTheDocument();
  });

  it('tints the disc with the seat role', () => {
    const { container } = render(<PlayerAvatar profile={null} displayName="Ada" role="opp" />);
    expect(container.querySelector('.player-avatar--opp')).toBeInTheDocument();
  });
});
