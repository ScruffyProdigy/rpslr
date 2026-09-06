import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Board } from './App';
import type { MatchState, Move, Seat } from './api';

const MY_SEAT = 'a';
const MY_PLAYER = 'player-a';
const OPP_PLAYER = 'player-b';

function seat(seatKey: string, playerId: string | null, delays: Record<string, number> = {}): Seat {
  return {
    id: `seat-${seatKey}`,
    matchId: 'match-1',
    seatKey,
    teamKey: null,
    role: seatKey === MY_SEAT ? 'Challenger' : 'Opponent',
    position: seatKey === MY_SEAT ? 0 : 1,
    reservedForLobbyUser: null,
    player: playerId
      ? { id: playerId, name: playerId, lobbyUserId: null, score: 0, profile: null }
      : null,
    lobbyProfile: null,
    delays,
  };
}

function state(over: {
  currentRound?: number;
  bothSeated?: boolean;
  myDelays?: Record<string, number>;
  oppDelays?: Record<string, number>;
  submitted?: string[];
} = {}): MatchState {
  const {
    currentRound = 1,
    bothSeated = true,
    myDelays = {},
    oppDelays = {},
    submitted = [],
  } = over;
  return {
    match: {
      id: 'match-1',
      code: 'RPS-TEST',
      externalMatchId: 'ext-1',
      lobbyId: null,
      lobbyReturnUrl: null,
      lobbyGraphqlUrl: null,
      name: 'Friendly Match',
      gameMode: 'rpslr',
      status: 'playing',
      bestOf: 5,
      currentRound,
      createdAt: '2026-01-01T00:00:00Z',
    },
    seats: [seat(MY_SEAT, MY_PLAYER, myDelays), seat('b', bothSeated ? OPP_PLAYER : null, oppDelays)],
    results: [],
    submittedPlayerIds: submitted,
    currentRoundMoves: {},
    matchWinnerSeatKey: null,
  };
}

function renderBoard(s: MatchState, myChosenMove: Move | null = null) {
  return render(
    <Board
      myPlayerId={MY_PLAYER}
      mySeatKey={MY_SEAT}
      state={s}
      connected
      error={null}
      myChosenMove={myChosenMove}
      onPlay={() => {}}
    />,
  );
}

describe('<Board> rules note (JQ-101)', () => {
  it('shows the rules while waiting for the opponent', () => {
    renderBoard(state({ bothSeated: false }));
    expect(screen.getByText(/First to 3 round wins/)).toBeInTheDocument();
  });

  it('shows the rules during round 1', () => {
    renderBoard(state({ currentRound: 1 }));
    expect(screen.getByText(/Lizard & Robot start on cooldown/)).toBeInTheDocument();
  });

  it('hides the rules from round 2 on', () => {
    renderBoard(state({ currentRound: 2 }));
    expect(screen.queryByText(/First to 3 round wins/)).not.toBeInTheDocument();
  });

  it('derives the win target from bestOf', () => {
    const s = state();
    s.match.bestOf = 3;
    renderBoard(s);
    expect(screen.getByText(/First to 2 round wins/)).toBeInTheDocument();
  });
});

describe('<Board> cooldown pill (JQ-103)', () => {
  it('renders a numeric pill with an aria-label instead of dots', () => {
    renderBoard(state({ myDelays: { lizard: 2 } }));
    expect(screen.getByLabelText('on cooldown, 2 turns')).toHaveTextContent('2');
  });

  it('singularises a one-turn cooldown', () => {
    renderBoard(state({ myDelays: { robot: 1 } }));
    expect(screen.getByLabelText('on cooldown, 1 turn')).toBeInTheDocument();
  });

  it('names the cooldown on the button itself so it is announced', () => {
    renderBoard(state({ myDelays: { lizard: 2 } }));
    expect(screen.getByRole('button', { name: /Lizard, on cooldown, 2 turns/ })).toBeDisabled();
  });

  it('does not render opponent cooldown marks on the buttons', () => {
    renderBoard(state({ oppDelays: { rock: 3 } }));
    expect(screen.queryByLabelText(/opponent cooldown/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rock' })).toBeEnabled();
  });
})

describe('<Board> live indicator (JQ-99)', () => {
  it('no longer renders the developer live/connecting label', () => {
    renderBoard(state());
    expect(screen.queryByText(/● live|○ connecting/)).not.toBeInTheDocument();
  });
});
