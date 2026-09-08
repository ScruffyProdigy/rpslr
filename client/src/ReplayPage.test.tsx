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
    // Paused, so the round is read rather than watched and shows all at once.
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));

    expect(
      screen.getByText(
        'Ana plays Rock, Ben plays Scissors — Rock crushes Scissors. Ana leads 1–0.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Ana's Rock is now out for 2 rounds.")).toBeInTheDocument();
  });

  it('explains a rule the first round it is visible, and lets it be dismissed', async () => {
    vi.spyOn(api, 'getState').mockResolvedValue(finishedState());
    render(<ReplayPage matchRef="ext-1" />);
    await screen.findByText('Ana');

    // Round 1 is played into the opening state, so nothing is resting yet.
    expect(screen.queryByRole('button', { name: 'Got it' })).not.toBeInTheDocument();

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

    expect(container.querySelector('.replay-commentary__line')).toHaveTextContent('');
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
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

    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous round' })).toBeDisabled();
  });
});
