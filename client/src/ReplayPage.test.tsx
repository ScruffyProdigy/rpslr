import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type MatchState, type Move, type RoundResult, type Seat } from './api';
import { markSeen } from './lib/prefs';
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
    loadout: null,
    loadoutRoll: null,
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
    abilityFirings: [],
    // No seat in these fixtures holds a charge, which is the duel case.
    abilities: {},
    entitlement: null,
    serverNow: '2026-09-07T00:05:00.000Z',
  };
}

/**
 * Everything on the page except the rules themselves.
 *
 * The how-to-play panels and the rule cards are the one place a replay says
 * "you", and they mean "whoever is playing" rather than the watcher — they are
 * the same copy a first match opens with. The no-second-person rule from
 * JQ-117 is about the *match* being narrated, so it is checked against the
 * match copy.
 */
function matchCopy(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.htp-dialog, .replay-rule-card').forEach((el) => el.remove());
  return clone.textContent ?? '';
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('<ReplayPage>', () => {
  // These cover the replay itself, not the first-visit intro over it — which
  // has a describe of its own below.
  beforeEach(() => markSeen('howToPlay'));

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
    expect(matchCopy(container)).not.toMatch(/\bYou\b|\byour\b|\bOpponent\b/i);
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

  it('gives every round a card of its own, not one that carries over', async () => {
    // The showdown is CSS animation-delays hanging off a single mount. A card
    // React reuses from one round to the next never mounts again, so round one
    // would animate and nothing after it would.
    vi.spyOn(api, 'getState').mockResolvedValue(finishedState());
    const { container } = render(<ReplayPage matchRef="ext-1" />);
    await screen.findByText('Ana');

    const first = container.querySelector('.reveal-card');
    await userEvent.click(screen.getByRole('button', { name: 'Next round' }));
    const second = container.querySelector('.reveal-card');

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });

  it('offers the way to JoinQuest even for a match with no return URL', async () => {
    // The CTA used to hang off match.lobbyReturnUrl, which is the way back to
    // *this match* for someone who played it — null for a standalone match, so
    // the button simply never appeared. A watcher wants the game's own page.
    vi.spyOn(api, 'getState').mockResolvedValue(finishedState({ lobbyReturnUrl: null }));
    render(<ReplayPage matchRef="ext-1" />);
    await screen.findByText('Ana');

    const cta = screen.getByRole('link', { name: /play rpslr on joinquest/i });
    expect(cta).toHaveAttribute(
      'href',
      'https://joinquest.cc/games/rock-paper-scissors-lizard-robot?ref=replay',
    );
  });

  it('plays the deciding round out before it declares the winner', async () => {
    // The last round is the one worth watching. Ending the moment the final
    // frame is reached shows its result on a scoreboard and never on the board.
    vi.spyOn(api, 'getState').mockResolvedValue(finishedState());
    render(<ReplayPage matchRef="ext-1" />);
    await screen.findByText('Ana');

    await userEvent.click(screen.getByRole('button', { name: 'Next round' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next round' }));

    expect(screen.getByText('Ana takes round 3')).toBeInTheDocument();
    expect(screen.queryByText('Ana wins the match.')).not.toBeInTheDocument();
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


describe('<ReplayPage> commentary', () => {
  beforeEach(() => markSeen('howToPlay'));

  it('narrates the round under the board', async () => {
    vi.spyOn(api, 'getState').mockResolvedValue(finishedState());
    render(<ReplayPage matchRef="ext-1" />);
    await screen.findByText('Ana');
    // Auto-play starts from an effect that runs a commit *after* the match
    // renders, so the transport still reads Play at the moment 'Ana' appears
    // (JQ-213). Wait for the button to say Pause rather than for the names.
    // Paused, so the round is read rather than watched and shows all at once.
    await userEvent.click(await screen.findByRole('button', { name: 'Pause' }));

    expect(
      screen.getByText(
        'Ana plays Rock, Ben plays Scissors — Rock crushes Scissors. Ana leads 1–0.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Ana's Rock is out for the rest of the match."),
    ).toBeInTheDocument();
  });

  it('explains a rule the first round it is visible, and lets it be dismissed', async () => {
    vi.spyOn(api, 'getState').mockResolvedValue(finishedState());
    render(<ReplayPage matchRef="ext-1" />);
    await screen.findByText('Ana');

    // Round 1 demonstrates none of the rules that need a played move, so it
    // carries the one that is true of every round instead.
    expect(screen.getByText(/exactly three moves they can play/)).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Next round' }));
    expect(screen.getByText('Every move you play goes on cooldown for 2 rounds')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(
      screen.queryByText('Every move you play goes on cooldown for 2 rounds'),
    ).not.toBeInTheDocument();
  });

  it('keeps the round to itself until its card has landed', async () => {
    // Auto-play is running, so the first round is mid-reveal: the sentence
    // would otherwise call the round before the card gets there.
    vi.spyOn(api, 'getState').mockResolvedValue(finishedState());
    const { container } = render(<ReplayPage matchRef="ext-1" />);
    await screen.findByText('Ana');
    // The empty line is only true *while* the replay is playing, and playing
    // begins one commit after the match renders — so the Pause button is what
    // says the reveal is under way, not the players' names (JQ-213).
    const pause = await screen.findByRole('button', { name: 'Pause' });

    expect(container.querySelector('.replay-commentary__line')).toHaveTextContent('');
    await userEvent.click(pause);
    expect(container.querySelector('.replay-commentary__line')).toHaveTextContent(
      /Ana plays Rock/,
    );
  });
});

describe('<ReplayPage> first-visit rules', () => {
  it('opens the rules once for a watcher who has never seen them', async () => {
    vi.spyOn(api, 'getState').mockResolvedValue(finishedState());
    const { container, unmount } = render(<ReplayPage matchRef="ext-1" />);
    await screen.findByText('Ana');

    await waitFor(() => expect(container.querySelector('.htp-dialog')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(container.querySelector('.htp-dialog')).not.toBeInTheDocument();
    unmount();

    const second = render(<ReplayPage matchRef="ext-1" />);
    await screen.findByText('Ana');
    expect(second.container.querySelector('.htp-dialog')).not.toBeInTheDocument();
  });

  it('reopens them from the header', async () => {
    markSeen('howToPlay');
    vi.spyOn(api, 'getState').mockResolvedValue(finishedState());
    const { container } = render(<ReplayPage matchRef="ext-1" />);
    await screen.findByText('Ana');

    await userEvent.click(screen.getByRole('button', { name: 'How to play' }));
    expect(container.querySelector('.htp-dialog')).toBeInTheDocument();
  });

  it('holds the replay where it is while the rules are up', async () => {
    // The intro lands on a replay that is already playing itself. It should
    // still be on round 1 when the panels close, not three rounds in.
    vi.spyOn(api, 'getState').mockResolvedValue(finishedState());
    const { container } = render(<ReplayPage matchRef="ext-1" />);
    await screen.findByText('Ana');
    await waitFor(() => expect(container.querySelector('.htp-dialog')).toBeInTheDocument());

    // Same one-commit gap as JQ-213: the rules dialog is up before auto-play
    // has been switched on, so the transport is waited for rather than read.
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous round' })).toBeDisabled();
  });
});

describe('<ReplayPage> play along', () => {
  beforeEach(() => markSeen('howToPlay'));

  /** Turn the replay into a game: the toggle, then the two-tap call. */
  async function playAlong() {
    await userEvent.click(screen.getByRole('button', { name: 'Play along' }));
  }

  async function call(move: string) {
    await userEvent.click(screen.getByRole('button', { name: move }));
    await userEvent.click(screen.getByRole('button', { name: move }));
  }

  it('watches until the watcher asks to play', async () => {
    vi.spyOn(api, 'getState').mockResolvedValue(finishedState());
    render(<ReplayPage matchRef="ext-1" />);
    await screen.findByText('Ana');

    expect(screen.getByRole('button', { name: 'Watch' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Play along' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('holds the round on the board until a move is called', async () => {
    vi.spyOn(api, 'getState').mockResolvedValue(finishedState());
    const { container } = render(<ReplayPage matchRef="ext-1" />);
    await screen.findByText('Ana');
    await playAlong();

    expect(screen.getByText('What does Ana play?')).toBeInTheDocument();
    expect(container.querySelector('.reveal-card')).toBeNull();
    expect(screen.getByRole('button', { name: 'Rock' })).toBeEnabled();
  });

  it('keeps the round it is asking about to itself', async () => {
    // The whole game is not knowing. A strip chip, a scoreline or a line of
    // commentary that has already resolved the round gives it away.
    vi.spyOn(api, 'getState').mockResolvedValue(finishedState());
    const { container } = render(<ReplayPage matchRef="ext-1" />);
    await screen.findByText('Ana');
    await playAlong();

    expect(container.querySelector('.replay-commentary__line')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Round 1:/ })).not.toBeInTheDocument();
    expect(screen.getByText('0–0')).toBeInTheDocument();
  });

  it('shows a call that came off against what was played', async () => {
    vi.spyOn(api, 'getState').mockResolvedValue(finishedState());
    render(<ReplayPage matchRef="ext-1" />);
    await screen.findByText('Ana');
    await playAlong();
    await call('Rock');

    expect(screen.getByText('You called it.')).toBeInTheDocument();
  });

  it('shows a call that missed against what was played', async () => {
    vi.spyOn(api, 'getState').mockResolvedValue(finishedState());
    render(<ReplayPage matchRef="ext-1" />);
    await screen.findByText('Ana');
    await playAlong();
    await call('Paper');

    expect(screen.getByText('You said Paper — Ana played Rock.')).toBeInTheDocument();
  });

  it('lets a round go by uncalled', async () => {
    vi.spyOn(api, 'getState').mockResolvedValue(finishedState());
    const { container } = render(<ReplayPage matchRef="ext-1" />);
    await screen.findByText('Ana');
    await playAlong();
    await userEvent.click(screen.getByRole('button', { name: 'Skip this round' }));

    expect(container.querySelector('.reveal-card')).toBeInTheDocument();
    expect(screen.queryByText('You called it.')).not.toBeInTheDocument();
  });

  it('counts the rounds that were called on the end card', async () => {
    vi.spyOn(api, 'getState').mockResolvedValue(finishedState());
    render(<ReplayPage matchRef="ext-1" />);
    await screen.findByText('Ana');
    await playAlong();

    await call('Paper'); // Ana played Rock — missed
    await userEvent.click(screen.getByRole('button', { name: 'Next round' }));
    await call('Paper'); // Ana played Paper — called
    await userEvent.click(screen.getByRole('button', { name: 'Next round' }));
    await userEvent.click(screen.getByRole('button', { name: 'Skip this round' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next round' }));

    expect(await screen.findByText('Ana wins the match.')).toBeInTheDocument();
    expect(screen.getByText('You called 1 of 2 rounds.')).toBeInTheDocument();
  });

  it('remembers play-along for the next replay opened', async () => {
    vi.spyOn(api, 'getState').mockResolvedValue(finishedState());
    const first = render(<ReplayPage matchRef="ext-1" />);
    await screen.findByText('Ana');
    await playAlong();
    first.unmount();

    render(<ReplayPage matchRef="ext-1" />);
    await screen.findByText('Ana');
    expect(screen.getByText('What does Ana play?')).toBeInTheDocument();
  });

  it('calls for the other player when the side is switched', async () => {
    vi.spyOn(api, 'getState').mockResolvedValue(finishedState());
    render(<ReplayPage matchRef="ext-1" />);
    await screen.findByText('Ana');
    await playAlong();
    await userEvent.click(screen.getByRole('button', { name: 'Play as Ben' }));

    expect(screen.getByText('What does Ben play?')).toBeInTheDocument();
    await call('Scissors');
    expect(screen.getByText('You called it.')).toBeInTheDocument();
  });

  it('forgets the calls made for the player just switched away from', async () => {
    vi.spyOn(api, 'getState').mockResolvedValue(finishedState());
    render(<ReplayPage matchRef="ext-1" />);
    await screen.findByText('Ana');
    await playAlong();
    await call('Rock');
    await userEvent.click(screen.getByRole('button', { name: 'Play as Ben' }));

    expect(screen.getByText('What does Ben play?')).toBeInTheDocument();
    expect(screen.queryByText('You called it.')).not.toBeInTheDocument();
  });
});

/**
 * A match that reaches the floor, so the page has to draw a board where no move
 * is clear.
 *
 * Rebuilt by JQ-209, which repriced the two cards that used to produce it. Rust
 * added two marks a firing on a three-mark recharge and Freeze recharged at all;
 * between them they buried a board twice in six rounds, which is the ~26pp each
 * turned out to be worth. Neither can now, so the floor is reached by
 * accumulation instead.
 *
 * Ana carries Echo Chamber, so every drawn round costs her an extra mark of her
 * own. Ben's Quarantine names her pick in rounds 1 and 4 and lands both, adding
 * two more each time. Five drawn rounds mean she pays for a pick every round with
 * nothing coming back, and Ben's Freeze — once per match now, so the timing is
 * the decision — holds the whole board for round 5. She comes into round 6 with a
 * mark on all five, playable only because `availableMoves` has a floor.
 *
 * The same script as the floor fixture in `commentary.test.ts`, deliberately: that
 * one asserts the board this one draws. Six rounds, because JQ-214 caps a best-of-3
 * at `bestOf * 2` — the match ends at the cap on Ana's 1-0, not on the threshold.
 *
 * The commentary used to reconstruct that hand as `delays[m] === 0` and get
 * nothing back, and hand the empty list to a solver that indexes three rows and
 * three columns unconditionally — which threw, and a throw here is a blank
 * replay rather than a wrong sentence (JQ-234).
 */
function floorState(): MatchState {
  const script: [Move, Move, string][] = [
    ['rock', 'rock', 'draw'],
    ['paper', 'paper', 'draw'],
    ['scissors', 'scissors', 'draw'],
    ['lizard', 'lizard', 'draw'],
    ['robot', 'robot', 'draw'],
    ['paper', 'rock', 'a'],
  ];
  const helped = seat(1, 'b', 'pb', 'Ben');
  return {
    ...finishedState({ bestOf: 3, currentRound: 6, gameMode: 'duel-helpers' }),
    seats: [
      { ...seat(0, 'a', 'pa', 'Ana'), loadout: ['echo-chamber', 'bookend'] },
      { ...helped, loadout: ['quarantine', 'freeze'] },
    ],
    results: script.map(([a, b, outcome], i) => round(i + 1, a, b, outcome)),
    abilityFirings: [
      { round: 1, seatKey: 'b', helperId: 'quarantine', target: 'rock', source: null },
      { round: 4, seatKey: 'b', helperId: 'quarantine', target: 'lizard', source: null },
      { round: 5, seatKey: 'b', helperId: 'freeze', target: null, source: null },
    ],
  };
}

describe('<ReplayPage> under the cooldown floor', () => {
  beforeEach(() => markSeen('howToPlay'));

  it('plays a match all the way through a fully-marked board', async () => {
    vi.spyOn(api, 'getState').mockResolvedValue(floorState());
    render(<ReplayPage matchRef="ext-1" />);
    await screen.findByText('Ana');
    // Auto-play starts from an effect a commit *after* the match renders, so the
    // transport still reads Play when 'Ana' appears — wait for Pause itself
    // (JQ-213). These two were the last places in the file still doing it the old
    // way, and CI caught them where a faster local run did not.
    await userEvent.click(await screen.findByRole('button', { name: 'Pause' }));

    for (let n = 2; n <= 6; n++) {
      await userEvent.click(screen.getByRole('button', { name: 'Next round' }));
    }

    // Round 6 is the one Ana enters with a mark on every move. Reaching its
    // sentence at all is the assertion: the commentary threw on the way here.
    expect(
      screen.getByText('Ana plays Paper, Ben plays Rock — Paper covers Rock. Ana wins the match 1–0.'),
    ).toBeInTheDocument();
  });

  it('says nothing infinite about a round played off the floor', async () => {
    vi.spyOn(api, 'getState').mockResolvedValue(floorState());
    const { container } = render(<ReplayPage matchRef="ext-1" />);
    await screen.findByText('Ana');
    // Auto-play starts from an effect a commit *after* the match renders, so the
    // transport still reads Play when 'Ana' appears — wait for Pause itself
    // (JQ-213). These two were the last places in the file still doing it the old
    // way, and CI caught them where a faster local run did not.
    await userEvent.click(await screen.findByRole('button', { name: 'Pause' }));

    for (let n = 2; n <= 6; n++) {
      await userEvent.click(screen.getByRole('button', { name: 'Next round' }));
    }
    expect(matchCopy(container)).not.toMatch(/Infinity|NaN|undefined/);
  });
});
