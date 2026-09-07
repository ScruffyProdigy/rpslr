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
          expiryStrikes: 0,
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
  /** Seconds left on the round clock; omit for no clock at all. */
  secondsLeft?: number;
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
    secondsLeft,
  } = over;
  const now = Date.now();
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
      phase: finished || secondsLeft === undefined ? null : 'pick',
      phaseStartedAt:
        secondsLeft === undefined ? null : new Date(now - 5_000).toISOString(),
      phaseDeadline:
        secondsLeft === undefined ? null : new Date(now + secondsLeft * 1000).toISOString(),
      endReason: finished ? 'played' : null,
      winnerSeatKey: null,
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
    serverNow: new Date(now).toISOString(),
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
  moves: { [MY_PLAYER]: 'paper', [OPP_PLAYER]: 'robot' }, autoPicked: [] 
};

describe('<Board> rules note (JQ-101)', () => {
  // Phase 4: the wait is filled by the how-to-play panels, which say all of
  // this and more, so the one-line note would only repeat them.
  it('leaves the rules to the how-to-play panels while waiting', () => {
    renderBoard(state({ bothSeated: false }));
    expect(screen.queryByText(/First to 3 round wins/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'First to 3' })).toBeInTheDocument();
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

  // Not `disabled`: a move you cannot play is still worth asking about, so it
  // stays focusable and tappable and answers with why. It can never commit.
  it('names the cooldown on the button itself so it is announced', () => {
    renderBoard(state({ myDelays: { lizard: 2 } }));
    const btn = screen.getByRole('button', { name: /Lizard, on cooldown, 2 turns/ });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
  });

  it('says why the move is unavailable, not just that it is', () => {
    renderBoard(state({ myDelays: { lizard: 2 } }));
    expect(
      screen.getByRole('button', { name: /Lizard, on cooldown, 2 turns, lizard starts the match/i }),
    ).toBeInTheDocument();
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

  it('shows the round clock beside the score (JQ-156)', () => {
    renderBoard(state({ currentRound: 4, scores: [2, 1], results: [ROUND_1], secondsLeft: 12 }));
    expect(screen.getByLabelText('12 seconds left this round')).toBeInTheDocument();
  });

  it('keeps the clock inside the scoreboard, which costs no page height', () => {
    // The board already overflows a 390x844 phone (JQ-165); the seat-card row
    // is centred and 201px tall, so the clock is free there and is not on the
    // round label, which would add a row.
    const { container } = renderBoard(
      state({ currentRound: 4, scores: [2, 1], results: [ROUND_1], secondsLeft: 12 }),
    );
    expect(container.querySelector('.scoreboard .round-timer')).not.toBeNull();
    expect(container.querySelector('.round-label .round-timer')).toBeNull();
  });

  it('shows no clock before the match has started', () => {
    const { container } = renderBoard(state({ bothSeated: false }));
    expect(container.querySelector('.round-timer')).toBeNull();
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

  it('announces the result through the region that was already on the board (JQ-157)', () => {
    // The card used to arrive carrying its own role="status", so the round
    // result was announced by a region mounted in the same tick — the case
    // screen readers most often drop. The board's region now outlives the
    // swap, and the result lands inside the region that was already there.
    const { container, rerender } = render(boardEl(state({ currentRound: 1 })));
    const before = container.querySelector('.move-board [role="status"]');
    expect(before).not.toBeNull();
    rerender(boardEl(state({ currentRound: 2, scores: [1, 0], results: [ROUND_1] })));
    const after = container.querySelector('.move-board [role="status"]');
    expect(after).toBe(before);
    expect(after).toHaveTextContent('You take round 1');
    expect(container.querySelectorAll('.move-board [role="status"]')).toHaveLength(1);
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
      moves: { [MY_PLAYER]: 'rock', [OPP_PLAYER]: 'rock' }, autoPicked: [] 
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
      moves: { [MY_PLAYER]: 'rock', [OPP_PLAYER]: 'scissors' }, autoPicked: [] 
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

describe('<Board> stable layout above the pentagon', () => {
  // The pentagon is the tap surface. Anything appearing above it mid-decision
  // moves the board under the player's thumb and causes mis-taps.
  it('reserves the status slot even with nothing to say', () => {
    const { container } = renderBoard(state());
    expect(container.querySelector('.board-status')).toBeInTheDocument();
    expect(container.querySelector('.opponent-ready')).not.toBeInTheDocument();
  });

  it('fills that same slot when the opponent locks in', () => {
    const { container } = renderBoard(state({ submitted: [OPP_PLAYER] }));
    const slot = container.querySelector('.board-status') as HTMLElement;
    expect(within(slot).getByText(/Opponent has locked in/)).toBeInTheDocument();
    expect(container.querySelectorAll('.board-status')).toHaveLength(1);
  });
});

describe('<Board> match end (JQ-114)', () => {
  function endedBoard() {
    return renderBoard(
      state({ currentRound: 3, scores: [3, 1], results: [ROUND_1], finished: true }),
    );
  }

  it('crowns the winner with their avatar', () => {
    const { container } = endedBoard();
    const end = container.querySelector('.match-end') as HTMLElement;
    expect(end.querySelector('.player-avatar--lg')).toBeInTheDocument();
    expect(end.querySelector('.player-avatar--winner')).toBeInTheDocument();
    expect(within(end).getByText('Ada')).toBeInTheDocument();
  });

  it('states the final score', () => {
    const { container } = endedBoard();
    const score = container.querySelector('.match-end__score') as HTMLElement;
    expect(score).toHaveAccessibleName('Final score: you 3, Grace 1');
  });

  // JQ-119: a match that just ended is the one thing a player has to share,
  // and until this there was no way to get at it from the screen that says so.
  it('offers the replay of the match that just ended', () => {
    const { container } = endedBoard();
    const share = within(container.querySelector('.match-end') as HTMLElement).getByRole(
      'button',
      { name: /share replay/i },
    );
    expect(share).toBeInTheDocument();
  });

  it('does not offer a replay of a match still being played', () => {
    const { container } = renderBoard(state({ currentRound: 2, results: [ROUND_1] }));
    expect(container.querySelector('.share-replay')).not.toBeInTheDocument();
  });

  // Phase 4: the end card takes the whole board, so the ending reads as an
  // ending rather than a board with a banner on it.
  it('takes the board away — no scoreboard, no picker, no history below', () => {
    const { container } = endedBoard();
    expect(container.querySelector('.move-picker')).not.toBeInTheDocument();
    expect(container.querySelector('.scoreboard')).not.toBeInTheDocument();
    expect(container.querySelector('.history')).not.toBeInTheDocument();
    // The rounds are still there — inside the card.
    expect(container.querySelectorAll('.match-end .history-chip')).toHaveLength(1);
  });
});

describe('<Board> pre-match (JQ 4.1)', () => {
  it('fills the wait with how-to-play instead of a waiting line', () => {
    const { container } = renderBoard(state({ bothSeated: false }));
    expect(screen.queryByText(/Waiting for all seats/)).not.toBeInTheDocument();
    expect(container.querySelectorAll('.htp-panel')).toHaveLength(3);
    expect(screen.getByRole('heading', { name: 'What beats what' })).toBeInTheDocument();
  });

  it('puts the picker away while there is nobody to play against', () => {
    const { container } = renderBoard(state({ bothSeated: false }));
    expect(container.querySelector('.move-picker')).not.toBeInTheDocument();
  });
});

describe('<Board> errors (JQ 4.3)', () => {
  it('renders an error under the picker, not above it', () => {
    const { container } = render(
      <Board
        myPlayerId={MY_PLAYER}
        mySeatKey={MY_SEAT}
        state={state()}
        connected
        error="Seat already taken"
        myChosenMove={null}
        onPlay={() => {}}
      />,
    );
    const err = screen.getByRole('alert');
    expect(err).toHaveTextContent('Seat already taken');
    const picker = container.querySelector('.move-picker') as HTMLElement;
    // An error appearing above would shift the pentagon under a thumb that is
    // mid-decision — the thing .board-status exists to prevent.
    expect(picker.compareDocumentPosition(err) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('<Board> reserved opponent (JQ 3.5)', () => {
  it('says the reserved opponent is on their way', () => {
    renderBoard(state({ bothSeated: false }));
    expect(screen.getByText(/on their way/i)).toBeInTheDocument();
  });
});
