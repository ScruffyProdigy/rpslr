import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MovePicker } from './MovePicker';
import type { Move } from '../api';
import { CIRCLE_ORDER } from '../lib/pentagon';
import { threatsTo } from '../moves';

function renderPicker(
  over: {
    myDelays?: Record<string, number>;
    oppDelays?: Record<string, number>;
    myChosenMove?: Move | null;
    lockedIn?: boolean;
    disabled?: boolean;
    round?: number;
    myRecentMoves?: Move[];
    onPlay?: (m: Move) => void;
    winningEdge?: { from: Move; to: Move; role: 'you' | 'opp' } | null;
    secondsLeft?: number | null;
  } = {},
) {
  const onPlay = over.onPlay ?? vi.fn();
  const utils = render(
    <MovePicker
      myDelays={over.myDelays ?? {}}
      oppDelays={over.oppDelays ?? {}}
      myChosenMove={over.myChosenMove ?? null}
      lockedIn={over.lockedIn ?? false}
      disabled={over.disabled ?? false}
      round={over.round ?? 3}
      myRecentMoves={over.myRecentMoves ?? []}
      onPlay={onPlay}
      secondsLeft={over.secondsLeft ?? null}
      winningEdge={over.winningEdge ?? null}
    />,
  );
  return { ...utils, onPlay };
}

/**
 * The centre slot. Its caption has to be read through this rather than off the
 * screen: since JQ-157 the board also carries a screen-reader summary of the
 * whole graph, which says the same five lines.
 */
function center(container: HTMLElement): HTMLElement {
  return container.querySelector('.picker-center') as HTMLElement;
}

/** The `<line>` for one "beats" edge, e.g. robot → rock. */
function arrow(container: HTMLElement, from: Move, to: Move): SVGLineElement {
  const el = container.querySelector<SVGLineElement>(`line[data-from="${from}"][data-to="${to}"]`);
  if (!el) throw new Error(`no arrow ${from} → ${to}`);
  return el;
}

function incomingArrows(container: HTMLElement, to: Move): SVGLineElement[] {
  return Array.from(container.querySelectorAll<SVGLineElement>(`line[data-to="${to}"]`));
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('<MovePicker> buttons carry only your own state (JQ 2.1/2.2)', () => {
  it('renders the five moves', () => {
    renderPicker();
    for (const m of CIRCLE_ORDER) {
      expect(screen.getByRole('button', { name: new RegExp(`^${m}`, 'i') })).toBeInTheDocument();
    }
  });

  it('marks only your own cooldowns unavailable, and shows the numeric pill', () => {
    renderPicker({ myDelays: { lizard: 2 }, oppDelays: { robot: 1 } });
    expect(screen.getByRole('button', { name: /^Lizard, on cooldown, 2 turns/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('button', { name: /^Robot/ })).not.toHaveAttribute('aria-disabled');
    expect(screen.getByLabelText('on cooldown, 2 turns')).toHaveTextContent('2');
  });

  it('never commits a move you cannot play, however many times you tap it', async () => {
    const user = userEvent.setup();
    const { onPlay } = renderPicker({ myDelays: { lizard: 2 } });
    const lizard = screen.getByRole('button', { name: /^Lizard/ });
    await user.click(lizard);
    await user.click(lizard);
    await user.click(lizard);
    expect(onPlay).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^Lock in/ })).not.toBeInTheDocument();
  });

  it('answers "why can I not play this?" when you tap it', async () => {
    const user = userEvent.setup();
    const { container } = renderPicker({ myDelays: { rock: 2 }, myRecentMoves: ['rock', 'paper'] });
    await user.click(screen.getByRole('button', { name: /^Rock/ }));
    const centre = container.querySelector('.picker-center--why') as HTMLElement;
    expect(centre).toHaveTextContent('You played Rock last round');
    expect(centre).toHaveTextContent('back in 2 turns');
  });

  it('reaches back two rounds when that is the reason', async () => {
    const user = userEvent.setup();
    const { container } = renderPicker({ myDelays: { paper: 1 }, myRecentMoves: ['rock', 'paper'] });
    await user.click(screen.getByRole('button', { name: /^Paper/ }));
    expect(container.querySelector('.picker-center--why')).toHaveTextContent(
      'You played Paper two rounds ago — back in 1 turn',
    );
  });

  it('drops the old opponent/self availability ring classes', () => {
    const { container } = renderPicker({ oppDelays: { robot: 1 } });
    expect(container.querySelector('.my-allowed')).toBeNull();
    expect(container.querySelector('.opp-allowed')).toBeNull();
  });

  it('dims the other moves only once you have locked in', () => {
    const { container, rerender } = renderPicker();
    expect(container.querySelector('.move-btn--dimmed')).toBeNull();
    rerender(
      <MovePicker
        myDelays={{}}
        oppDelays={{}}
        myChosenMove="rock"
        lockedIn
        disabled
        round={3}
        myRecentMoves={[]}
        onPlay={() => {}}
      />,
    );
    expect(container.querySelectorAll('.move-btn--dimmed')).toHaveLength(4);
    expect(screen.getByRole('button', { name: /^Rock/ })).toHaveClass('move-btn--selected');
  });
});

describe('<MovePicker> opponent cooldown is drawn on the graph (JQ 2.3)', () => {
  it('fades the arrows leaving a move the opponent cannot play, and no others', () => {
    const { container } = renderPicker({ oppDelays: { robot: 2 } });
    // Robot smashes Scissors & vaporizes Rock — neither attack is coming.
    expect(arrow(container, 'robot', 'rock')).toHaveClass('beat-arrow--opp-off');
    expect(arrow(container, 'robot', 'scissors')).toHaveClass('beat-arrow--opp-off');
    expect(container.querySelectorAll('.beat-arrow--opp-off')).toHaveLength(2);
  });

  it('leaves a safe move with no solid incoming arrow', () => {
    const oppDelays = { paper: 1, robot: 2 };
    const { container } = renderPicker({ oppDelays });

    expect(threatsTo('rock', oppDelays).safe).toBe(true);
    for (const line of incomingArrows(container, 'rock')) {
      expect(line).toHaveClass('beat-arrow--opp-off');
    }

    // Lizard is still beaten by Rock and Scissors, both playable.
    expect(threatsTo('lizard', oppDelays).safe).toBe(false);
    expect(
      incomingArrows(container, 'lizard').some((l) => !l.classList.contains('beat-arrow--opp-off')),
    ).toBe(true);
  });

  it('marks the node and names the wait in the preview caption', async () => {
    const user = userEvent.setup();
    renderPicker({ oppDelays: { robot: 2 } });
    await user.click(screen.getByRole('button', { name: /^Robot/ }));
    expect(screen.getByText("Opponent can't play Robot for 2 turns")).toBeInTheDocument();
  });

  it('shows a two-item legend', () => {
    renderPicker();
    const legend = screen.getByText(/your cooldown/);
    expect(legend).toHaveTextContent(
      /your cooldown · .*opponent cooldown \(faded arrows = attacks they can’t make\)/,
    );
  });
});

describe('<MovePicker> tap to preview, tap again to lock in (JQ 2.4)', () => {
  it('previews on the first tap without playing the move', async () => {
    const user = userEvent.setup();
    const { container, onPlay } = renderPicker();
    await user.click(screen.getByRole('button', { name: /^Rock/ }));

    expect(onPlay).not.toHaveBeenCalled();
    expect(within(center(container)).getByText('Rock crushes Scissors & Lizard')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Rock/ })).toHaveClass('move-btn--preview');
    expect(screen.getByRole('button', { name: /^Scissors/ })).toHaveClass('move-btn--target');
    expect(arrow(container, 'rock', 'lizard')).toHaveClass('beat-arrow--preview');
    expect(arrow(container, 'paper', 'rock')).not.toHaveClass('beat-arrow--preview');
  });

  it('locks in on the second tap of the same move', async () => {
    const user = userEvent.setup();
    const { onPlay } = renderPicker();
    const rock = screen.getByRole('button', { name: /^Rock/ });
    await user.click(rock);
    await user.click(rock);
    expect(onPlay).toHaveBeenCalledWith('rock');
  });

  it('switches the preview instead of locking when you tap a different move', async () => {
    const user = userEvent.setup();
    const { container, onPlay } = renderPicker();
    await user.click(screen.getByRole('button', { name: /^Rock/ }));
    await user.click(screen.getByRole('button', { name: /^Paper/ }));

    expect(onPlay).not.toHaveBeenCalled();
    expect(within(center(container)).getByText('Paper covers Rock & disproves Robot')).toBeInTheDocument();
  });

  it('offers an explicit Lock in button in the centre', async () => {
    const user = userEvent.setup();
    const { onPlay } = renderPicker();
    await user.click(screen.getByRole('button', { name: /^Scissors/ }));
    await user.click(screen.getByRole('button', { name: 'Lock in Scissors' }));
    expect(onPlay).toHaveBeenCalledWith('scissors');
  });

  it('previews on keyboard focus too', async () => {
    const user = userEvent.setup();
    const { container } = renderPicker();
    await user.tab();
    expect(within(center(container)).getByText('Rock crushes Scissors & Lizard')).toBeInTheDocument();
  });

  it('prompts before anything is previewed', () => {
    renderPicker();
    expect(screen.getByText('Pick a move')).toBeInTheDocument();
  });

  it('pins the caption for your pick once the round is locked', () => {
    const { container } = renderPicker({ lockedIn: true, disabled: true, myChosenMove: 'lizard' });
    expect(within(center(container)).getByText('Lizard eats Paper & poisons Robot')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Lock in/ })).not.toBeInTheDocument();
  });
});

describe('<MovePicker> one-time notes (JQ 2.4/2.6)', () => {
  it('shows the tap hint in the first two rounds and remembers dismissal', async () => {
    const user = userEvent.setup();
    const { unmount } = renderPicker({ round: 1 });
    const hint = screen.getByText(/Tap to preview · tap again to lock in/);
    expect(hint).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/Tap to preview/)).not.toBeInTheDocument();

    unmount();
    renderPicker({ round: 1 });
    expect(screen.queryByText(/Tap to preview/)).not.toBeInTheDocument();
  });

  it('drops the tap hint from round 3', () => {
    renderPicker({ round: 3 });
    expect(screen.queryByText(/Tap to preview/)).not.toBeInTheDocument();
  });

  it('retires the tap hint once you lock a move in', async () => {
    const user = userEvent.setup();
    const { unmount } = renderPicker({ round: 1 });
    const rock = screen.getByRole('button', { name: /^Rock/ });
    await user.click(rock);
    await user.click(rock);

    unmount();
    renderPicker({ round: 2 });
    expect(screen.queryByText(/Tap to preview/)).not.toBeInTheDocument();
  });

  it('explains your first cooldown using the move you just played', () => {
    renderPicker({ round: 3, myDelays: { rock: 2 }, myRecentMoves: ['rock'] });
    expect(
      screen.getByText("You played Rock last round — it's back in 2 turns."),
    ).toBeInTheDocument();
  });

  it('falls back to the opening cooldowns when there is no previous round', () => {
    renderPicker({ round: 1, myDelays: { lizard: 1, robot: 2 } });
    // The tap hint owns round 1; the cooldown note takes over once it is gone.
    expect(screen.queryByText(/start on cooldown/)).not.toBeInTheDocument();

    window.localStorage.setItem('rpslr.seen.tapHint', '1');
    renderPicker({ round: 1, myDelays: { lizard: 1, robot: 2 } });
    expect(screen.getByText(/Lizard & Robot start on cooldown/)).toBeInTheDocument();
  });

  it('shows at most one note at a time', () => {
    const { container } = renderPicker({ round: 1, myDelays: { lizard: 1, robot: 2 } });
    expect(container.querySelectorAll('.picker-note')).toHaveLength(1);
  });

  it('says nothing about cooldowns when none of your moves are on one', () => {
    renderPicker({ round: 3, oppDelays: { robot: 2 } });
    expect(screen.queryByText(/back in/)).not.toBeInTheDocument();
    expect(screen.queryByText(/start on cooldown/)).not.toBeInTheDocument();
  });

  it('survives localStorage throwing', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => renderPicker({ round: 1 })).not.toThrow();
    expect(screen.getByText(/Tap to preview/)).toBeInTheDocument();
    spy.mockRestore();
  });
});


describe('<MovePicker> winning arrow replay (JQ 3.1)', () => {
  it('lights only the arrow the round was won on', () => {
    const { container } = renderPicker({
      winningEdge: { from: 'rock', to: 'scissors', role: 'you' },
    });
    expect(arrow(container, 'rock', 'scissors')).toHaveClass('beat-arrow--won');
    expect(container.querySelectorAll('.beat-arrow--won')).toHaveLength(1);
  });

  it('carries the winner’s role so the arrow takes their colour', () => {
    const { container } = renderPicker({
      winningEdge: { from: 'robot', to: 'rock', role: 'opp' },
    });
    expect(arrow(container, 'robot', 'rock')).toHaveClass('beat-arrow--won-opp');
  });

  // Phase 2 fades arrows leaving an opponent-cooldown node; the win must
  // still read as a win when it came from one.
  it('outranks the opponent-cooldown fade', () => {
    const { container } = renderPicker({
      oppDelays: { robot: 2 },
      winningEdge: { from: 'robot', to: 'rock', role: 'opp' },
    });
    const won = arrow(container, 'robot', 'rock');
    expect(won).toHaveClass('beat-arrow--won');
    expect(won).not.toHaveClass('beat-arrow--opp-off');
  });

  it('marks nothing when the round was a draw', () => {
    const { container } = renderPicker({ winningEdge: null });
    expect(container.querySelectorAll('.beat-arrow--won')).toHaveLength(0);
    expect(container.querySelector('.move-arrows--strike')).not.toBeInTheDocument();
  });

  // The rest of the graph steps back for the beat — but only for that beat.
  it('fades the rest of the graph only while the winning edge is lit', () => {
    const { container, rerender } = renderPicker({
      winningEdge: { from: 'rock', to: 'scissors', role: 'you' },
    });
    expect(container.querySelector('.move-arrows--strike')).toBeInTheDocument();
    rerender(
      <MovePicker
        myDelays={{}}
        oppDelays={{}}
        myChosenMove={null}
        lockedIn={false}
        disabled={false}
        round={3}
        myRecentMoves={[]}
        onPlay={() => {}}
        winningEdge={null}
      />,
    );
    expect(container.querySelector('.move-arrows--strike')).not.toBeInTheDocument();
  });
});


describe('<MovePicker> clearing a preview to see the board (JQ-95 follow-up)', () => {
  it('clears the preview when you tap the board away from a move', async () => {
    const user = userEvent.setup();
    const { container } = renderPicker();
    await user.click(screen.getByRole('button', { name: /^Rock/ }));
    expect(screen.getByRole('button', { name: /^Lock in/ })).toBeInTheDocument();
    await user.click(container.querySelector('.move-arrows') as unknown as Element);
    expect(screen.queryByRole('button', { name: /^Lock in/ })).not.toBeInTheDocument();
    expect(container.querySelector('.picker-center--idle')).toBeInTheDocument();
  });

  it('does not clear when the tap lands on a move button', async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(screen.getByRole('button', { name: /^Rock/ }));
    await user.click(screen.getByRole('button', { name: /^Paper/ }));
    expect(screen.getByRole('button', { name: /^Lock in Paper/ })).toBeInTheDocument();
  });

  it('does not swallow the Lock in button', async () => {
    const user = userEvent.setup();
    const { onPlay } = renderPicker();
    await user.click(screen.getByRole('button', { name: /^Rock/ }));
    await user.click(screen.getByRole('button', { name: /^Lock in Rock/ }));
    expect(onPlay).toHaveBeenCalledWith('rock');
  });

  it('clears the preview on Escape', async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(screen.getByRole('button', { name: /^Rock/ }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: /^Lock in/ })).not.toBeInTheDocument();
  });

  // Once you are locked in the centre belongs to the waiting state; a stray tap
  // on the board must not disturb it.
  it('leaves the locked-in centre alone', async () => {
    const user = userEvent.setup();
    const { container } = renderPicker({ lockedIn: true, disabled: true, myChosenMove: 'lizard' });
    await user.click(container.querySelector('.move-arrows') as unknown as Element);
    expect(container.querySelector('.picker-center--waiting')).toBeInTheDocument();
  });
});


describe('<MovePicker> auto-commit at the deadline (JQ-156)', () => {
  /** Re-render with a new clock reading, keeping everything else identical. */
  function tickTo(
    rerender: (ui: React.ReactElement) => void,
    secondsLeft: number | null,
    props: { onPlay: (m: Move) => void; myDelays?: Record<string, number> },
  ) {
    rerender(
      <MovePicker
        myDelays={props.myDelays ?? {}}
        oppDelays={{}}
        myChosenMove={null}
        lockedIn={false}
        disabled={false}
        round={3}
        myRecentMoves={[]}
        onPlay={props.onPlay}
        secondsLeft={secondsLeft}
        winningEdge={null}
      />,
    );
  }

  it('plays the move you tapped rather than letting the server pick at random', async () => {
    const user = userEvent.setup();
    const onPlay = vi.fn();
    const { rerender } = renderPicker({ onPlay, secondsLeft: 10 });

    await user.click(screen.getByRole('button', { name: /rock/i }));
    expect(onPlay).not.toHaveBeenCalled(); // one tap is still not a commit

    tickTo(rerender, 2, { onPlay });
    expect(onPlay).toHaveBeenCalledWith('rock');
  });

  it('leaves you the decision for nearly the whole round', async () => {
    const user = userEvent.setup();
    const onPlay = vi.fn();
    const { rerender } = renderPicker({ onPlay, secondsLeft: 10 });

    await user.click(screen.getByRole('button', { name: /rock/i }));
    tickTo(rerender, 3, { onPlay });
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('never commits a move you only hovered', async () => {
    // `preview` falls back to `hovered`, which is mouse-over and keyboard
    // focus. Committing that would be worse than random: a cursor resting on
    // the board would silently decide the round.
    const user = userEvent.setup();
    const onPlay = vi.fn();
    const { rerender } = renderPicker({ onPlay, secondsLeft: 10 });

    await user.hover(screen.getByRole('button', { name: /rock/i }));
    tickTo(rerender, 1, { onPlay });
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('commits nothing when you never tapped', () => {
    const onPlay = vi.fn();
    const { rerender } = renderPicker({ onPlay, secondsLeft: 10 });
    tickTo(rerender, 1, { onPlay });
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('does not commit a move you tapped to ask why it is on cooldown', async () => {
    const user = userEvent.setup();
    const onPlay = vi.fn();
    const { rerender } = renderPicker({ onPlay, secondsLeft: 10, myDelays: { rock: 2 } });

    await user.click(screen.getByRole('button', { name: /rock/i }));
    tickTo(rerender, 1, { onPlay, myDelays: { rock: 2 } });
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('does not fire when there is no clock running', async () => {
    const user = userEvent.setup();
    const onPlay = vi.fn();
    const { rerender } = renderPicker({ onPlay, secondsLeft: null });

    await user.click(screen.getByRole('button', { name: /rock/i }));
    tickTo(rerender, null, { onPlay });
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('commits once, not on every tick past the threshold', async () => {
    const user = userEvent.setup();
    const onPlay = vi.fn();
    const { rerender } = renderPicker({ onPlay, secondsLeft: 10 });

    await user.click(screen.getByRole('button', { name: /rock/i }));
    tickTo(rerender, 2, { onPlay });
    tickTo(rerender, 1, { onPlay });
    tickTo(rerender, 0, { onPlay });
    expect(onPlay).toHaveBeenCalledTimes(1);
  });
});

describe('<MovePicker> gives the pentagon a text equivalent (JQ-157)', () => {
  /*
   * The arrows are drawn into an aria-hidden SVG, so without this the game's
   * core teaching device is unreachable: the only textual access was the
   * preview caption, one move at a time.
   */
  it('summarises what beats what outside the aria-hidden arrows', () => {
    const { container } = renderPicker();
    expect(container.querySelector('.move-arrows')).toHaveAttribute('aria-hidden', 'true');
    const graph = screen.getByRole('region', { name: /what beats what/i });
    expect(within(graph).getByText('Rock crushes Scissors & Lizard')).toBeInTheDocument();
    expect(within(graph).getByText('Robot smashes Scissors & vaporizes Rock')).toBeInTheDocument();
  });

  it('names the attacks the faded arrows stand for', () => {
    renderPicker({ oppDelays: { lizard: 2 } });
    const graph = screen.getByRole('region', { name: /what beats what/i });
    expect(within(graph).getByText(/can't play Lizard/)).toBeInTheDocument();
  });

  it('says so when every arrow is live', () => {
    renderPicker();
    const graph = screen.getByRole('region', { name: /what beats what/i });
    expect(within(graph).getByText(/every arrow is live/)).toBeInTheDocument();
  });

  it('is read on demand rather than announced', () => {
    // A cooldown ticking down must not interrupt the round.
    const graph = (renderPicker(), screen.getByRole('region', { name: /what beats what/i }));
    expect(graph.closest('[role="status"]')).toBeNull();
    expect(graph).not.toHaveAttribute('aria-live');
  });
});

/** A picker with only the centre slot varying, for the live-region tests. */
function boardEl(centerSlot?: React.ReactNode) {
  return (
    <MovePicker
      myDelays={{}}
      oppDelays={{}}
      myChosenMove={null}
      lockedIn={false}
      disabled={false}
      round={3}
      myRecentMoves={[]}
      onPlay={() => {}}
      secondsLeft={null}
      winningEdge={null}
      centerSlot={centerSlot}
    />
  );
}

describe('<MovePicker> speaks through one live region (JQ-157)', () => {
  it('carries a single live region on the board', () => {
    const { container } = renderPicker();
    const board = container.querySelector('.move-board') as HTMLElement;
    expect(board.querySelectorAll('[role="status"], [aria-live]')).toHaveLength(1);
  });

  it('keeps that region mounted when the reveal takes the centre', () => {
    // A live region mounted with its content already in it is not reliably
    // announced, and the round result is the one thing that must never be
    // dropped. So the region outlives the swap; only its contents change.
    const { container, rerender } = render(boardEl());
    const before = container.querySelector('[role="status"]');
    expect(before).not.toBeNull();
    rerender(boardEl(<p className="reveal-card">You take round 2</p>));
    const after = container.querySelector('[role="status"]');
    expect(after).toBe(before);
    expect(after).toHaveTextContent('You take round 2');
  });

  it('announces the preview caption through it', async () => {
    const user = userEvent.setup();
    const { container } = renderPicker();
    await user.click(screen.getByRole('button', { name: /^Rock/ }));
    expect(container.querySelector('[role="status"]')).toHaveTextContent(
      'Rock crushes Scissors & Lizard',
    );
  });

  it('announces the pick and the wait through it after lock-in', () => {
    const { container } = renderPicker({ lockedIn: true, myChosenMove: 'rock' });
    expect(container.querySelector('[role="status"]')).toHaveTextContent(/Waiting for opponent/);
  });
});
