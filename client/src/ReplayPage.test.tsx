import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type MatchState, type Move, type RoundResult, type Seat } from './api';
import { ReplayPage } from './ReplayPage';

function seat(position: number, seatKey: string, playerId: string, name: string): Seat {
  return {
    id: `seat-${seatKey}`,
    matchId: 'm1',
    seatKey,
    teamKey: null,
    role: null,
    position,
    reservedForLobbyUser: null,
    player: { id: playerId, name, lobbyUserId: null, score: 0, profile: null, expiryStrikes: 0 },
    lobbyProfile: null,
    delays: {},
  };
}

function round(n: number, a: Move, b: Move, outcome: string): RoundResult {
  return { round: n, outcome, moves: { pa: a, pb: b }, autoPicked: [] };
}

function finishedState(overrides: Partial<MatchState['match']> = {}): MatchState {
  return {
    match: {
      id: 'm1',
      code: 'ABCD',
      externalMatchId: 'ext-1',
      lobbyId: null,
      lobbyReturnUrl: null,
      lobbyGraphqlUrl: null,
      name: 'Match',
      gameMode: 'rpslr',
      status: 'finished',
      bestOf: 5,
      currentRound: 3,
      phase: null,
      phaseStartedAt: null,
      phaseDeadline: null,
      endReason: 'played',
      winnerSeatKey: 'a',
      createdAt: '2026-09-07T00:00:00.000Z',
      ...overrides,
    },
    seats: [seat(0, 'a', 'pa', 'Ana'), seat(1, 'b', 'pb', 'Ben')],
    results: [
      round(1, 'rock', 'scissors', 'a'),
      round(2, 'paper', 'scissors', 'b'),
      round(3, 'scissors', 'paper', 'a'),
    ],
    submittedPlayerIds: [],
    currentRoundMoves: {},
    matchWinnerSeatKey: 'a',
    serverNow: '2026-09-07T00:05:00.000Z',
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('<ReplayPage>', () => {
  it('shows both players by name once the match loads', async () => {
    vi.spyOn(api, 'getState').mockResolvedValue(finishedState());
    render(<ReplayPage matchRef="ext-1" />);

    expect(await screen.findByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Ben')).toBeInTheDocument();
    expect(api.getState).toHaveBeenCalledWith('ext-1');
  });

  it('never says "You" or "Opponent"', async () => {
    vi.spyOn(api, 'getState').mockResolvedValue(finishedState());
    const { container } = render(<ReplayPage matchRef="ext-1" />);
    await screen.findByText('Ana');
    expect(container.textContent).not.toMatch(/\bYou\b|\byour\b|\bOpponent\b/i);
  });

  it('refuses a match that is still running', async () => {
    vi.spyOn(api, 'getState').mockResolvedValue(finishedState({ status: 'playing' }));
    render(<ReplayPage matchRef="ext-1" />);
    expect(await screen.findByText("This match isn't over yet")).toBeInTheDocument();
  });

  it('says so when the link does not point at a match', async () => {
    vi.spyOn(api, 'getState').mockRejectedValue(new Error('match not found'));
    render(<ReplayPage matchRef="nope" />);
    expect(await screen.findByText(/match not found/i)).toBeInTheDocument();
  });

  it('jumps to a round when its chip is tapped', async () => {
    vi.spyOn(api, 'getState').mockResolvedValue(finishedState());
    render(<ReplayPage matchRef="ext-1" />);
    await screen.findByText('Ana');

    await userEvent.click(screen.getByRole('button', { name: /^Round 1:/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Round 1:/ })).toHaveAttribute(
        'aria-current',
        'true',
      ),
    );
  });

  it('ends on the final score with the winner named', async () => {
    vi.spyOn(api, 'getState').mockResolvedValue(finishedState());
    render(<ReplayPage matchRef="ext-1" />);
    await screen.findByText('Ana');

    await userEvent.click(screen.getByRole('button', { name: 'Next round' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next round' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next round' }));

    expect(await screen.findByText('Ana wins the match.')).toBeInTheDocument();
  });
});
