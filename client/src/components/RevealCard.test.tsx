import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RevealCard } from './RevealCard';
import type { RoundResult } from '../api';

const MY_PLAYER = 'player-a';
const OPP_PLAYER = 'player-b';
const YOU = { profile: null, name: 'Ada', placeholder: false };
const OPP = { profile: null, name: 'Grace', placeholder: false };

function result(over: Partial<RoundResult> = {}): RoundResult {
  return {
    round: 2,
    outcome: 'a',
    moves: { [MY_PLAYER]: 'paper', [OPP_PLAYER]: 'robot' },
    autoPicked: [],
    ...over,
  };
}

function renderCard(r: RoundResult = result(), phase: 'card' | 'outro' = 'card') {
  const onSkip = vi.fn();
  const utils = render(
    <RevealCard
      result={r}
      phase={phase}
      mySeatKey="a"
      myPlayerId={MY_PLAYER}
      you={YOU}
      opponent={OPP}
      onSkip={onSkip}
    />,
  );
  return { ...utils, onSkip };
}

describe('<RevealCard> (JQ 3.1)', () => {
  it('shows both picks, the verb line and the verdict', () => {
    const { container } = renderCard();
    const card = container.querySelector('.reveal-card') as HTMLElement;
    expect(card.querySelector('svg[data-move="paper"]')).toBeInTheDocument();
    expect(card.querySelector('svg[data-move="robot"]')).toBeInTheDocument();
    expect(within(card).getByText('Paper disproves Robot')).toBeInTheDocument();
    expect(within(card).getByText('You take round 2')).toBeInTheDocument();
  });

  // 3.5: avatars stand in for the words "You" and "Opponent".
  it('flanks the moves with both avatars and no You/Opponent labels', () => {
    const { container } = renderCard();
    const card = container.querySelector('.reveal-card') as HTMLElement;
    expect(card.querySelectorAll('.player-avatar')).toHaveLength(2);
    expect(within(card).queryByText(/^(You|Opponent)$/)).not.toBeInTheDocument();
  });

  it('names the opponent when they take the round', () => {
    renderCard(result({ outcome: 'b' }));
    expect(screen.getByText('Grace takes round 2')).toBeInTheDocument();
  });

  it('reads a mirror match as a draw', () => {
    renderCard(result({ outcome: 'draw', moves: { [MY_PLAYER]: 'rock', [OPP_PLAYER]: 'rock' } }));
    expect(screen.getByText('Draw')).toBeInTheDocument();
    expect(screen.getByText(/same pick, no winner/)).toBeInTheDocument();
  });

  // The outro dissolves the card so the lit arrow underneath can be seen.
  it('marks itself as exiting during the outro', () => {
    const { container } = renderCard(result(), 'outro');
    expect(container.querySelector('.reveal-card--exiting')).toBeInTheDocument();
  });

  it('is not exiting while the card still holds', () => {
    const { container } = renderCard();
    expect(container.querySelector('.reveal-card--exiting')).not.toBeInTheDocument();
  });

  it('announces itself and offers an explicit skip', () => {
    const { container, onSkip } = renderCard();
    expect(container.querySelector('[role="status"]')).toBeInTheDocument();
    screen.getByRole('button', { name: /skip/i }).click();
    expect(onSkip).toHaveBeenCalled();
  });
});
