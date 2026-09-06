import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Board } from './App';
import type { MatchState, Move, RoundResult, Seat } from './api';

const MY_SEAT = 'a';
const MY_PLAYER = 'player-a';
const OPP_PLAYER = 'player-b';

function seat(
  seatKey: string,
  playerId: string | null,
  delays: Record<string, number> = {},
  score = 0,
): Seat {
  return {
    id: `seat-${seatKey}`,
    matchId: 'match-1',
    seatKey,
    teamKey: null,
    role: seatKey === MY_SEAT ? 'Challenger' : 'Opponent',
    position: seatKey === MY_SEAT ? 0 : 1,
    // Lobby matches reserve both seats up front, so an empty seat is a player
    // who hasn't arrived yet rather than an open slot.
    reservedForLobbyUser: playerId ? null : `lobby-${seatKey}`,
    player: playerId
      ? {
          id: playerId,
          name: seatKey === MY_SEAT ? 'Ada' : 'Grace',
          lobbyUserId: null,
          score,
          profile: null,
        }
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
  results?: RoundResult[];
  scores?: [number, number];
  finished?: boolean;
} = {}): MatchState {
  const {
    currentRound = 1,
    bothSeated = true,
    myDelays = {},
    oppDelays = {},
    submitted = [],
    results = [],
    scores = [0, 0],
    finished = false,
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
      status: finished ? 'finished' : 'playing',
      bestOf: 5,
      currentRound,
      createdAt: '2026-01-01T00:00:00Z',
    },
    seats: [
      seat(MY_SEAT, MY_PLAYER, myDelays, scores[0]),
      seat('b', bothSeated ? OPP_PLAYER : null, oppDelays, scores[1]),
    ],
    results,
    submittedPlayerIds: submitted,
    currentRoundMoves: {},
    matchWinnerSeatKey: finished ? MY_SEAT : null,
  };
}

function boardEl(s: MatchState, myChosenMove: Move | null = null) {
  return (
    <Board
      myPlayerId={MY_PLAYER}
      mySeatKey={MY_SEAT}
      state={s}
      connected
      error={null}
      myChosenMove={myChosenMove}
      onPlay={() => {}}
    />
  );
}

function renderBoard(s: MatchState, myChosenMove: Move | null = null) {
  return render(boardEl(s, myChosenMove));
}

const ROUND_1: RoundResult = {
  round: 1,
  outcome: MY_SEAT,
  moves: { [MY_PLAYER]: 'paper', [OPP_PLAYER]: 'robot' },
};

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

  // Phase 2.3 moved the opponent's state off your button's border and onto the
  // node as a marker; it still must not affect whether you can play the move.
  it('marks an opponent cooldown on the node without disabling your button', () => {
    renderBoard(state({ oppDelays: { rock: 3 } }));
    expect(screen.getByRole('button', { name: 'Rock, opponent cooldown, 3 turns' })).toBeEnabled();
  });
})

describe('<Board> live indicator (JQ-99)', () => {
  it('no longer renders the developer live/connecting label', () => {
    renderBoard(state());
    expect(screen.queryByText(/● live|○ connecting/)).not.toBeInTheDocument();
  });
});

describe('<Board> round header (JQ 3.2)', () => {
  it('carries the running score beside the round number', () => {
    renderBoard(state({ currentRound: 4, scores: [2, 1], results: [ROUND_1] }));
    expect(screen.getByText('Round 4 · You 2 – 1')).toBeInTheDocument();
  });

  it('pulses the pip of the seat that just took the round', () => {
    const { container, rerender } = render(boardEl(state({ currentRound: 1 })));
    expect(container.querySelector('.win-pip--pulse')).not.toBeInTheDocument();
    rerender(
      boardEl(state({ currentRound: 2, scores: [1, 0], results: [ROUND_1] })),
    );
    const mine = container.querySelector('.player.you') as HTMLElement;
    expect(mine.querySelector('.win-pip--pulse')).toBeInTheDocument();
  });
});

describe('<Board> round reveal (JQ 3.1)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not replay finished rounds when a page reload lands mid-match', () => {
    const { container } = renderBoard(state({ currentRound: 2, results: [ROUND_1] }));
    expect(container.querySelector('.reveal-card')).not.toBeInTheDocument();
  });

  it('reveals the round in the pentagon centre when the result arrives', () => {
    const { container, rerender } = render(boardEl(state({ currentRound: 1 })));
    rerender(boardEl(state({ currentRound: 2, scores: [1, 0], results: [ROUND_1] })));
    const card = container.querySelector('.reveal-card') as HTMLElement;
    expect(within(card).getByText('Paper disproves Robot')).toBeInTheDocument();
    expect(within(card).getByText('You take round 1')).toBeInTheDocument();
  });

  it('locks the picker while the reveal is up', () => {
    const { rerender } = render(boardEl(state({ currentRound: 1 })));
    rerender(boardEl(state({ currentRound: 2, scores: [1, 0], results: [ROUND_1] })));
    expect(screen.getByRole('button', { name: /^Rock/ })).toBeDisabled();
  });

  it('hands the board back to the picker after the hold and the outro', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(boardEl(state({ currentRound: 1 })));
    rerender(boardEl(state({ currentRound: 2, scores: [1, 0], results: [ROUND_1] })));
    act(() => {
      vi.advanceTimersByTime(2700);
    });
    // Still the reveal's time: the card is dissolving over the lit arrow.
    expect(container.querySelector('.reveal-card')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Rock/ })).toBeDisabled();
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(container.querySelector('.reveal-card')).not.toBeInTheDocument();
    expect(container.querySelector('.beat-arrow--won')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Rock/ })).toBeEnabled();
  });

  it('dissolves the card onto the arrow the round was won on', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(boardEl(state({ currentRound: 1 })));
    rerender(boardEl(state({ currentRound: 2, scores: [1, 0], results: [ROUND_1] })));
    // Paper disproves Robot: nothing lit while the card is still up.
    expect(container.querySelector('.beat-arrow--won')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2700);
    });
    const won = container.querySelector('.beat-arrow--won') as SVGLineElement;
    expect(won).toHaveAttribute('data-from', 'paper');
    expect(won).toHaveAttribute('data-to', 'robot');
    expect(container.querySelector('.reveal-card--exiting')).toBeInTheDocument();
  });

  it('lights nothing on a drawn round', () => {
    vi.useFakeTimers();
    const drawn: RoundResult = {
      round: 1,
      outcome: 'draw',
      moves: { [MY_PLAYER]: 'rock', [OPP_PLAYER]: 'rock' },
    };
    const { container, rerender } = render(boardEl(state({ currentRound: 1 })));
    rerender(boardEl(state({ currentRound: 2, results: [drawn] })));
    act(() => {
      vi.advanceTimersByTime(2700);
    });
    expect(container.querySelector('.reveal-card--exiting')).toBeInTheDocument();
    expect(container.querySelector('.beat-arrow--won')).not.toBeInTheDocument();
  });

  it('skipping ends the outro too', () => {
    const { container, rerender } = render(boardEl(state({ currentRound: 1 })));
    rerender(boardEl(state({ currentRound: 2, scores: [1, 0], results: [ROUND_1] })));
    fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    expect(container.querySelector('.reveal-card')).not.toBeInTheDocument();
    expect(container.querySelector('.beat-arrow--won')).not.toBeInTheDocument();
  });

  it('can be skipped by tapping', () => {
    const { container, rerender } = render(boardEl(state({ currentRound: 1 })));
    rerender(boardEl(state({ currentRound: 2, scores: [1, 0], results: [ROUND_1] })));
    fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    expect(container.querySelector('.reveal-card')).not.toBeInTheDocument();
  });

  // The deciding round is the one most worth seeing, so it plays before the
  // match-end banner takes the screen.
  it('plays the deciding round before the match-end banner', () => {
    vi.useFakeTimers();
    const finalRound: RoundResult = {
      round: 3,
      outcome: MY_SEAT,
      moves: { [MY_PLAYER]: 'rock', [OPP_PLAYER]: 'scissors' },
    };
    const { container, rerender } = render(boardEl(state({ currentRound: 3, scores: [2, 1] })));
    rerender(
      boardEl(state({ currentRound: 3, scores: [3, 1], results: [finalRound], finished: true })),
    );
    expect(container.querySelector('.reveal-card')).toBeInTheDocument();
    expect(screen.queryByText(/You win the match/)).not.toBeInTheDocument();
    // Two advances: the outro timer is only scheduled once the card's expires.
    act(() => {
      vi.advanceTimersByTime(2700);
    });
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(screen.getByText(/You win the match/)).toBeInTheDocument();
  });
});

describe('<Board> waiting for the opponent (JQ 3.3)', () => {
  it('shows your pick in the pentagon centre instead of a page-level paragraph', () => {
    const { container } = renderBoard(state({ submitted: [MY_PLAYER] }), 'rock');
    expect(container.querySelector('.choice-locked')).not.toBeInTheDocument();
    const center = container.querySelector('.picker-center--waiting') as HTMLElement;
    expect(center.querySelector('.picker-center__pick')).toHaveTextContent('Rock');
    expect(within(center).getByText(/Waiting for opponent/)).toBeInTheDocument();
  });

  it('says the round is revealing once both sides are in', () => {
    const { container } = renderBoard(
      state({ submitted: [MY_PLAYER, OPP_PLAYER] }),
      'rock',
    );
    const center = container.querySelector('.picker-center--waiting') as HTMLElement;
    expect(within(center).getByText(/Revealing round/)).toBeInTheDocument();
  });
});

describe('<Board> match end (JQ-114)', () => {
  it('crowns the winner with their avatar above the banner', () => {
    const { container } = renderBoard(
      state({ currentRound: 3, scores: [3, 1], results: [ROUND_1], finished: true }),
    );
    const results = container.querySelector('.match-results') as HTMLElement;
    expect(results.querySelector('.player-avatar--lg')).toBeInTheDocument();
    expect(results.querySelector('.match-results__winner')).toBeInTheDocument();
    expect(within(results).getByText('Ada')).toBeInTheDocument();
  });
});

describe('<Board> reserved opponent (JQ 3.5)', () => {
  it('says the reserved opponent is on their way', () => {
    renderBoard(state({ bothSeated: false }));
    expect(screen.getByText(/on their way/i)).toBeInTheDocument();
  });
});
