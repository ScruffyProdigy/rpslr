import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { MatchState, Move, RoundResult, Seat } from '../api';
import type { RuleCardId } from '../commentary';
import { buildReplay, type Replay } from '../replay';
import { ReplayCommentary } from './ReplayCommentary';

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

const RESULTS = [
  round(1, 'rock', 'paper', 'b'),
  round(2, 'scissors', 'rock', 'b'),
  round(3, 'paper', 'lizard', 'b'),
];

function replayFixture(): Replay {
  const state: MatchState = {
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
      winnerSeatKey: 'b',
      createdAt: '2026-09-07T00:00:00.000Z',
    },
    seats: [seat(0, 'a', 'pa', 'Ana'), seat(1, 'b', 'pb', 'Ben')],
    results: RESULTS,
    submittedPlayerIds: [],
    currentRoundMoves: {},
    matchWinnerSeatKey: 'b',
    serverNow: '2026-09-07T00:05:00.000Z',
  };
  return buildReplay(state);
}

function renderAt(
  index: number,
  overrides: { card?: RuleCardId | null; settled?: boolean } = {},
) {
  const replay = replayFixture();
  return render(
    <ReplayCommentary
      frame={replay.frames[index]}
      replay={replay}
      card={overrides.card ?? null}
      settled={overrides.settled ?? true}
    />,
  );
}

describe('<ReplayCommentary>', () => {
  it('says what happened in the round once the reveal has landed', () => {
    renderAt(0);
    expect(screen.getByText(/Ana plays Rock, Ben plays Paper/)).toHaveTextContent(
      'Paper covers Rock. Ben leads 1–0.',
    );
  });

  it('holds the round back while its card is still playing', () => {
    const { container } = renderAt(0, { settled: false });
    expect(container.textContent).not.toMatch(/Ana plays Rock/);
    // The live region itself stays, so the sentence is announced when it lands
    // rather than arriving with the region that carries it.
    expect(container.querySelector('[role="status"]')).toBeInTheDocument();
  });

  it('adds the notes the sentence has no room for', () => {
    renderAt(0);
    expect(screen.getByText("Ben's Paper is now out for 2 rounds.")).toBeInTheDocument();
  });

  it('shows the rule this round is the first to demonstrate, until it is dismissed', async () => {
    renderAt(1, { card: 'cooldown' });
    expect(screen.getByText('Every move you play goes on cooldown for 2 rounds')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(
      screen.queryByText('Every move you play goes on cooldown for 2 rounds'),
    ).not.toBeInTheDocument();
  });

  it('shows no rule card on a round that teaches nothing new', () => {
    renderAt(1);
    expect(screen.queryByRole('button', { name: 'Got it' })).not.toBeInTheDocument();
  });
});
