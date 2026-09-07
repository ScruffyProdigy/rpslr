import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { History } from './History';
import type { RoundResult } from '../api';

const PLAYER_A = 'player-a';
const PLAYER_B = 'player-b';
const YOU = { profile: null, name: 'Ada', placeholder: false };
const OPP = { profile: null, name: 'Grace', placeholder: false };

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

function renderHistory(over: Partial<Parameters<typeof History>[0]> = {}) {
  return render(
    <History
      results={results}
      mySeatKey="a"
      myPlayerId={PLAYER_A}
      you={YOU}
      opponent={OPP}
      {...over}
    />,
  );
}

describe('<History> compact strip (JQ 3.4)', () => {
  it('renders one chip per round with both picks', () => {
    const { container } = renderHistory();
    const strip = container.querySelector('.history-strip') as HTMLElement;
    const chips = within(strip).getAllByRole('button');
    expect(chips).toHaveLength(3);
    expect(chips[0]).toHaveTextContent('R1');
    expect(chips[0]).toHaveTextContent('📄');
    expect(chips[0]).toHaveTextContent('🤖');
  });

  it('names the round, the picks and the winner for assistive tech', () => {
    const { container } = renderHistory();
    const strip = container.querySelector('.history-strip') as HTMLElement;
    const chips = within(strip).getAllByRole('button');
    expect(chips[0]).toHaveAccessibleName('Round 1: Paper vs Robot — you won');
    expect(chips[1]).toHaveAccessibleName('Round 2: Rock vs Rock — draw');
    expect(chips[2]).toHaveAccessibleName('Round 3: Scissors vs Rock — Grace won');
  });

  // 3.5: the winner's avatar replaces "You won / You lost" on the chip.
  it('marks the round winner with an avatar, and a draw with neither', () => {
    const { container } = renderHistory();
    const chips = Array.from(container.querySelectorAll('.history-chip'));
    expect(chips[0].querySelector('.player-avatar')).toBeInTheDocument();
    expect(chips[1].querySelector('.player-avatar')).not.toBeInTheDocument();
    expect(chips[2].querySelector('.player-avatar')).toBeInTheDocument();
  });

  it('reveals the verb line when a chip is tapped', async () => {
    const user = userEvent.setup();
    const { container } = renderHistory();
    expect(container.querySelector('.history-strip__detail')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Round 1:/ }));
    const detail = container.querySelector('.history-strip__detail') as HTMLElement;
    expect(detail).toHaveTextContent('Paper disproves Robot');
    await user.click(screen.getByRole('button', { name: /^Round 1:/ }));
    expect(container.querySelector('.history-strip__detail')).not.toBeInTheDocument();
  });

  it('keeps the full list behind a disclosure', () => {
    const { container } = renderHistory();
    const full = container.querySelector('details.history-full') as HTMLElement;
    expect(within(full).getByText('You won')).toBeInTheDocument();
    expect(within(full).getByText('You lost')).toBeInTheDocument();
    expect(within(full).getByText('Draw')).toBeInTheDocument();
    expect(within(full).getByText('Rock crushes Scissors')).toBeInTheDocument();
    expect(within(full).getByText(/Rock vs Rock — same pick, no winner/)).toBeInTheDocument();
  });

  it('flips win/loss for the opponent seat', () => {
    const { container } = renderHistory({
      results: [{ round: 1, outcome: 'a', moves: { [PLAYER_A]: 'paper', [PLAYER_B]: 'robot' } }],
      mySeatKey: 'b',
      myPlayerId: PLAYER_B,
      you: OPP,
      opponent: YOU,
    });
    const strip = container.querySelector('.history-strip') as HTMLElement;
    expect(within(strip).getAllByRole('button')[0]).toHaveAccessibleName(
      'Round 1: Robot vs Paper — Ada won',
    );
    const full = container.querySelector('details.history-full') as HTMLElement;
    expect(within(full).getByText('You lost')).toBeInTheDocument();
  });

  // Phase 4: the match-end card owns the way back to the Lobby, so History
  // adding a second button was a duplicate on the only screen showing both.
  it('leaves the way back to the Lobby to the match-end card', () => {
    renderHistory();
    expect(screen.queryByRole('link', { name: /Lobby/ })).not.toBeInTheDocument();
  });

  it('renders nothing when there are no results', () => {
    const { container } = renderHistory({ results: [] });
    expect(container).toBeEmptyDOMElement();
  });
});
