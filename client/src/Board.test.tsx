import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Board } from './App';
import type { Entitlement } from '@game/types';
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
    loadout: null,
    loadoutRoll: null,
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
  /** Overrides the phase the clock would otherwise imply — 'loadouts', say. */
  phase?: MatchState['match']['phase'];
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
    phase,
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
      phase: phase ?? (finished || secondsLeft === undefined ? null : 'pick'),
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
    abilityFirings: [],
    // No seat in these fixtures holds a charge, which is the duel case.
    abilities: {},
    entitlement: null,
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

/**
 * JQ-221's AC #7: the duel board renders exactly as today. `duel` brings the
 * null loadout, so no seat holds a charge, so there must be no rail — not an
 * empty one, which is still a box the layout has to place.
 */
describe('<Board> ability rail (JQ-221)', () => {
  /** A seat holding one ability, which is what a helpers loadout can bring. */
  function withAbility(s: MatchState, helperId: string, marks: number | null): MatchState {
    const seats = s.seats.map((seat) =>
      seat.seatKey === MY_SEAT
        ? { ...seat, loadout: [helperId, 'echo-chamber'] as unknown as Seat['loadout'] }
        : seat,
    );
    return {
      ...s,
      seats,
      abilities: { [helperId]: { marks, available: marks === 0 } },
    };
  }

  it('draws no rail on a duel board', () => {
    renderBoard(state());
    expect(screen.queryByRole('region', { name: /your abilities/i })).not.toBeInTheDocument();
  });

  it('draws no rail when the board is given no fire handler', () => {
    render(
      <Board
        myPlayerId={MY_PLAYER}
        mySeatKey={MY_SEAT}
        state={withAbility(state(), 'rust', 0)}
        connected
        error={null}
        myChosenMove={null}
        onPlay={() => {}}
      />,
    );
    expect(screen.queryByRole('region', { name: /your abilities/i })).not.toBeInTheDocument();
  });

  it('draws the rail for a seat that holds a charge', () => {
    render(
      <Board
        myPlayerId={MY_PLAYER}
        mySeatKey={MY_SEAT}
        state={withAbility(state(), 'rust', 0)}
        connected
        error={null}
        myChosenMove={null}
        onPlay={() => {}}
        onFire={() => {}}
      />,
    );
    expect(screen.getByRole('region', { name: /your abilities/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /rust — ready/i })).toBeInTheDocument();
  });

  /*
   * `fireAbility` refuses during the sub-phase — "the round is already resolving",
   * non-cascading so a window cannot open another — so the board must not offer
   * what the server will refuse.
   */
  it('blocks firing while the sub-phase is running, and blames the round', () => {
    const s = withAbility(state({ submitted: [MY_PLAYER, OPP_PLAYER] }), 'rust', 0);
    render(
      <Board
        myPlayerId={MY_PLAYER}
        mySeatKey={MY_SEAT}
        state={{ ...s, match: { ...s.match, phase: 'react' } }}
        connected
        error={null}
        myChosenMove="rock"
        onPlay={() => {}}
        onFire={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /fire rust/i })).toBeDisabled();
    // Not "reconnecting": `fireAbility` refuses because the round is resolving,
    // and a player told to check their connection would be chasing nothing.
    expect(screen.getByText('The round is resolving.')).toBeInTheDocument();
  });
});

describe('<Board> mid-round sub-phase (JQ-221)', () => {
  function reactState(over: { entitlement?: Entitlement | null } = {}) {
    const s = state({ submitted: [MY_PLAYER, OPP_PLAYER] });
    return {
      ...s,
      match: { ...s.match, phase: 'react' as const },
      currentRoundMoves: { [MY_PLAYER]: 'rock' as Move },
      entitlement:
        'entitlement' in over
          ? (over.entitlement ?? null)
          : {
              round: 1,
              reveals: [{ helperId: 'oracle', namedMove: 'paper' as Move }],
              incoming: [],
              acted: false,
            },
    };
  }

  it('re-opens the pentagon for an entitled seat, which may replace its pick', () => {
    renderBoard(reactState(), 'rock');
    expect(screen.getByText(/they did not play/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Lizard/ })).toBeEnabled();
  });

  /*
   * A seat with no entitlement is locked while the round resolves — `submitMove`
   * says exactly that — so its board says so rather than offering a tap.
   */
  it('keeps an unentitled seat locked out, and says why', () => {
    renderBoard(reactState({ entitlement: null }), 'rock');
    expect(screen.queryByText(/they did not play/i)).not.toBeInTheDocument();
    expect(screen.getByText(/the round is resolving/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Lizard/ })).toBeDisabled();
  });

  /*
   * `acted` is the server's record of having answered, and it closes the window:
   * a second send would be refused, so the board stops offering one.
   */
  it('locks the pentagon again once this seat has used its window', () => {
    const s = reactState();
    renderBoard(
      { ...s, entitlement: { ...s.entitlement!, acted: true } },
      'rock',
    );
    expect(screen.getByText(/your answer is in/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Lizard/ })).toBeDisabled();
  });
});

/**
 * The loadout reveal, and the check it turns into (JQ-149).
 *
 * The window itself is `useLoadoutReveal`'s and tested there; what the board owes
 * is that the sheet reaches the screen, that it stays reachable once the reveal is
 * over, and that a duel board renders none of it.
 */
describe('<Board> loadouts (JQ-149)', () => {
  /** Both seats holding a helpers loadout, as a provisioned `duel-helpers` match. */
  function withLoadouts(
    s: MatchState,
    mine: string[] = ['ferrus', 'echo-chamber'],
    theirs: string[] = ['chimera', 'poker-face'],
    myRoll: Move | null = null,
  ): MatchState {
    return {
      ...s,
      seats: s.seats.map((seat) =>
        seat.seatKey === MY_SEAT
          ? { ...seat, loadout: mine as unknown as Seat['loadout'], loadoutRoll: myRoll }
          : { ...seat, loadout: theirs as unknown as Seat['loadout'] },
      ),
    };
  }

  function boardWith(s: MatchState, revealLoadouts = false) {
    return render(
      <Board
        myPlayerId={MY_PLAYER}
        mySeatKey={MY_SEAT}
        state={s}
        connected
        error={null}
        myChosenMove={null}
        onPlay={() => {}}
        revealLoadouts={revealLoadouts}
        onDismissReveal={() => {}}
      />,
    );
  }

  it('shows both loadouts face up while the reveal is running', () => {
    boardWith(withLoadouts(state()), true);
    const sheet = screen.getByRole('dialog', { name: 'Loadouts revealed' });
    expect(within(sheet).getByText('Ferrus')).toBeInTheDocument();
    expect(within(sheet).getByText('Chimera')).toBeInTheDocument();
  });

  it('names the move a collision displaced marks onto — the first sight of it', () => {
    boardWith(withLoadouts(state(), ['ferrus', 'well-oiled'], undefined, 'lizard'), true);
    expect(screen.getByText(/Both helpers bind the same move/)).toHaveTextContent(/Lizard/);
  });

  it('keeps the loadouts reachable from either seat card once the reveal is over', () => {
    boardWith(withLoadouts(state({ currentRound: 4 })));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Grace's loadout: Chimera, Poker Face/ }));
    const sheet = screen.getByRole('dialog', { name: 'Loadouts' });
    expect(within(sheet).getByText('Chimera')).toBeInTheDocument();
    expect(within(sheet).getByText('Ferrus')).toBeInTheDocument();
  });

  it('names both helpers in the button, so a screen reader gets them without a tap', () => {
    boardWith(withLoadouts(state()));
    expect(
      screen.getByRole('button', { name: /Your loadout: Ferrus, Echo Chamber/ }),
    ).toBeInTheDocument();
  });

  it('renders none of it on a duel board', () => {
    boardWith(state(), true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /loadout/i })).not.toBeInTheDocument();
  });

  /**
   * The reveal is a phase, so round 1 genuinely has not started during it — the
   * server refuses a move and a firing outright. The board must not offer what
   * the server will turn down, and must say why rather than looking broken.
   */
  describe('the board while the reveal phase runs', () => {
    const revealing = () => withLoadouts(state({ phase: 'loadouts', secondsLeft: 40 }));

    it('takes no pick, even from a player who has dismissed the sheet', () => {
      boardWith(revealing());
      for (const name of [/^Rock/, /^Paper/, /^Scissors/]) {
        expect(screen.getByRole('button', { name })).toBeDisabled();
      }
    });

    it('does not tell a player to pick from a board that takes no picks', () => {
      boardWith(revealing());
      expect(screen.getByText("Round 1 hasn't started")).toBeInTheDocument();
      expect(screen.queryByText('Pick a move')).not.toBeInTheDocument();
    });

    it('says what everyone is waiting for once the sheet is gone', () => {
      boardWith(revealing());
      expect(
        screen.getByText(/Round 1 starts once you have both read the loadouts/),
      ).toBeInTheDocument();
    });

    it('says it only after the sheet is gone — under a modal it is talking to nobody', () => {
      boardWith(revealing(), true);
      expect(
        screen.queryByText(/Round 1 starts once you have both read the loadouts/),
      ).not.toBeInTheDocument();
    });

    it('hands the board back as soon as the phase does', () => {
      boardWith(withLoadouts(state({ phase: 'pick', secondsLeft: 40 })));
      expect(screen.getByRole('button', { name: /^Rock/ })).toBeEnabled();
      expect(
        screen.queryByText(/Round 1 starts once you have both read the loadouts/),
      ).not.toBeInTheDocument();
    });

    it('refuses a firing with a reason the player can act on', () => {
      // Rust is a charge card, so this seat actually has a rail to be refused on.
      const s = withLoadouts(state({ phase: 'loadouts', secondsLeft: 40 }), [
        'rust',
        'echo-chamber',
      ]);
      render(
        <Board
          myPlayerId={MY_PLAYER}
          mySeatKey={MY_SEAT}
          state={{ ...s, abilities: { rust: { marks: 0, available: true } } }}
          connected
          error={null}
          myChosenMove={null}
          onPlay={() => {}}
          onFire={() => {}}
        />,
      );
      const rail = screen.getByRole('region', { name: /your abilities/i });
      expect(within(rail).getByText('Round 1 has not started yet.')).toBeInTheDocument();
    });
  });
});

/**
 * The opponent's opening, on the pentagon.
 *
 * JQ-151 built the badge and owns how it draws — `MovePicker.test.tsx` covers
 * that, including the duel case where a count would restate what the history
 * strip already says. What is left for here is the wiring JQ-149 depends on: the
 * board deciding *when* the counts are on, which neither that suite (it is handed
 * the flag) nor this ticket's own reveal tests exercise.
 *
 * It matters to JQ-149 because the reveal's promise is that both openings are
 * legible before the first pick, and half of that promise is drawn by this badge
 * rather than by the sheet.
 */
describe('<Board> opponent cooldown counts (JQ-149 / JQ-151)', () => {
  const counted = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('.opp-cooldown-mark--counted'));

  it('turns the counts on once either seat has brought a loadout', () => {
    const s = {
      ...state({ oppDelays: { robot: 2, paper: 1 } }),
      seats: state().seats.map((seat) => ({
        ...seat,
        loadout: ['ferrus', 'echo-chamber'] as unknown as Seat['loadout'],
        delays: seat.seatKey === MY_SEAT ? {} : { robot: 2, paper: 1 },
      })),
    };
    const { container } = render(
      <Board
        myPlayerId={MY_PLAYER}
        mySeatKey={MY_SEAT}
        state={s}
        connected
        error={null}
        myChosenMove={null}
        onPlay={() => {}}
      />,
    );
    // Both marks, and the legend badge that teaches them.
    expect(counted(container).map((el) => el.textContent?.trim())).toEqual(['1', '2', 'N']);
  });

  it('leaves a duel board exactly as it was — no counts, and none promised', () => {
    const { container } = renderBoard(state({ oppDelays: { robot: 2 } }));
    expect(counted(container)).toEqual([]);
    // The legend must not teach a number the board never draws.
    expect(container.querySelector('.opp-cooldown-mark--legend')?.textContent?.trim()).toBe('');
  });

  it('still says the depth in words on the move itself, which is what is announced', () => {
    renderBoard(state({ oppDelays: { robot: 2 } }));
    expect(
      screen.getByRole('button', { name: /Robot, opponent cooldown, 2 turns/ }),
    ).toBeInTheDocument();
  });
});
