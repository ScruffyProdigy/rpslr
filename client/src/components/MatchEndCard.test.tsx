import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MatchEndCard } from './MatchEndCard';
import type { RoundResult } from '../api';

const MY_PLAYER = 'player-a';
const OPP_PLAYER = 'player-b';
const YOU = { profile: null, name: 'Ada', placeholder: false };
const OPP = { profile: null, name: 'Grace', placeholder: false };

const RESULTS: RoundResult[] = [
  { round: 1, outcome: 'a', moves: { [MY_PLAYER]: 'paper', [OPP_PLAYER]: 'robot' } },
  { round: 2, outcome: 'b', moves: { [MY_PLAYER]: 'rock', [OPP_PLAYER]: 'paper' } },
  { round: 3, outcome: 'a', moves: { [MY_PLAYER]: 'lizard', [OPP_PLAYER]: 'paper' } },
  { round: 4, outcome: 'a', moves: { [MY_PLAYER]: 'robot', [OPP_PLAYER]: 'scissors' } },
];

function renderCard(over: Partial<Parameters<typeof MatchEndCard>[0]> = {}) {
  return render(
    <MatchEndCard
      iWon
      drawn={false}
      you={YOU}
      opponent={OPP}
      myScore={3}
      oppScore={1}
      results={RESULTS}
      mySeatKey="a"
      myPlayerId={MY_PLAYER}
      lobbyReturnUrl="https://lobby.example/return"
      {...over}
    />,
  );
}

describe('<MatchEndCard>', () => {
  it('states the final score, which no screen used to show at all', () => {
    const { container } = renderCard();
    const score = container.querySelector('.match-end__score') as HTMLElement;
    expect(score).toHaveTextContent('3');
    expect(score).toHaveTextContent('1');
    expect(score).toHaveAccessibleName('Final score: you 3, Grace 1');
  });

  it('crowns the winner with their avatar and a trophy', () => {
    const { container } = renderCard();
    expect(screen.getByText('You win the match!')).toBeInTheDocument();
    const avatar = container.querySelector('.match-end__winner .player-avatar') as HTMLElement;
    expect(avatar).toHaveClass('player-avatar--winner');
    expect(avatar).toHaveClass('player-avatar--you');
  });

  it('names the opponent as winner and keeps their amber identity', () => {
    const { container } = renderCard({ iWon: false, myScore: 1, oppScore: 3 });
    expect(screen.getByText('Grace wins the match.')).toBeInTheDocument();
    const avatar = container.querySelector('.match-end__winner .player-avatar') as HTMLElement;
    expect(avatar).toHaveClass('player-avatar--winner');
    expect(avatar).toHaveClass('player-avatar--opp');
  });

  it('does not colour a loss as an error', () => {
    const { container } = renderCard({ iWon: false, myScore: 1, oppScore: 3 });
    const verdict = container.querySelector('.match-end__verdict') as HTMLElement;
    expect(verdict).toHaveClass('loss');
    expect(container.querySelector('.error')).not.toBeInTheDocument();
    expect(container.querySelector('.result-banner')).not.toBeInTheDocument();
  });

  it('offers exactly one way back to the Lobby', () => {
    renderCard();
    expect(screen.getAllByRole('link', { name: /Lobby/ })).toHaveLength(1);
  });

  it('offers none when the match was not Lobby-linked', () => {
    renderCard({ lobbyReturnUrl: null });
    expect(screen.queryByRole('link', { name: /Lobby/ })).not.toBeInTheDocument();
  });

  it('shows how the match went, round by round', () => {
    const { container } = renderCard();
    const chips = container.querySelectorAll('.history-chip');
    expect(chips).toHaveLength(4);
    expect(chips[0]).toHaveAccessibleName('Round 1: Paper vs Robot — you won');
  });

  it('handles a match that ended with no winner', () => {
    const { container } = renderCard({ drawn: true, myScore: 2, oppScore: 2 });
    expect(screen.getByText('The match ends level.')).toBeInTheDocument();
    expect(container.querySelector('.match-end__winner')).not.toBeInTheDocument();
  });
});
