import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DelayMap } from '@game/game';
import { MovePicker } from './MovePicker';
import type { Move } from '../api';
import { CIRCLE_ORDER } from '../lib/pentagon';
import { SHARED_BEATS, threatsTo, type BeatsMap } from '../moves';
import { PLAYER_VOICE, spectatorVoice, type Voice } from '../lib/voice';
import { targetSteps } from '../abilities';
import type { Targeting } from '../lib/useAbilityTargeting';
import type { Identity } from '../lib/seatProfile';
import type { MarkEvent } from '@game/game';

/** What a duel opens on; every fixture here is a duel unless it says otherwise. */
const DUEL_OPENING: DelayMap = { rock: 0, paper: 0, scissors: 0, lizard: 1, robot: 2 };

type Over = {
  myDelays?: Record<string, number>;
  oppDelays?: Record<string, number>;
  myChosenMove?: Move | null;
  lockedIn?: boolean;
  opponentLockedIn?: boolean;
  disabled?: boolean;
  round?: number;
  myRecentMoves?: Move[];
  myOpeningDelays?: DelayMap;
  onPlay?: (m: Move) => void;
  winningEdge?: { from: Move; to: Move; role: 'you' | 'opp'; added: boolean } | null;
  secondsLeft?: number | null;
  myBeats?: BeatsMap;
  oppBeats?: BeatsMap;
  myLedger?: readonly MarkEvent[];
  oppCanFreeze?: boolean;
  voice?: Voice;
  oppName?: string;
  you?: Identity;
  opponent?: Identity;
  targeting?: Targeting | null;
  onNameTarget?: (m: Move) => void;
  onCancelTargeting?: () => void;
  onConfirmTargeting?: () => void;
  demandOwnBoard?: number | null;
};

function pickerEl(over: Over & { onPlay: (m: Move) => void }) {
  return (
    <MovePicker
      myDelays={over.myDelays ?? {}}
      oppDelays={over.oppDelays ?? {}}
      myChosenMove={over.myChosenMove ?? null}
      lockedIn={over.lockedIn ?? false}
      opponentLockedIn={over.opponentLockedIn ?? false}
      disabled={over.disabled ?? false}
      round={over.round ?? 3}
      myRecentMoves={over.myRecentMoves ?? []}
      myOpeningDelays={over.myOpeningDelays ?? DUEL_OPENING}
      onPlay={over.onPlay}
      secondsLeft={over.secondsLeft ?? null}
      winningEdge={over.winningEdge ?? null}
      myBeats={over.myBeats ?? SHARED_BEATS}
      oppBeats={over.oppBeats ?? SHARED_BEATS}
      myLedger={over.myLedger ?? []}
      oppCanFreeze={over.oppCanFreeze ?? false}
      voice={over.voice ?? PLAYER_VOICE}
      oppName={over.oppName ?? 'Robin'}
      you={over.you}
      opponent={over.opponent}
      targeting={over.targeting ?? null}
      onNameTarget={over.onNameTarget}
      onCancelTargeting={over.onCancelTargeting}
      onConfirmTargeting={over.onConfirmTargeting}
      demandOwnBoard={over.demandOwnBoard ?? null}
    />
  );
}

function renderPicker(over: Over = {}) {
  const onPlay = over.onPlay ?? vi.fn();
  const props = { ...over, onPlay };
  const utils = render(pickerEl(props));
  /** Re-render with a few props changed and everything else held still. */
  const rerenderWith = (next: Over = {}) => utils.rerender(pickerEl({ ...props, ...next }));
  return { ...utils, onPlay, rerenderWith };
}

/** The tabs, in the order the strip draws them: yours, then theirs. */
function tabs(): HTMLElement[] {
  return screen.getAllByRole('tab');
}

/** Open the opponent's board. */
async function showTheirs() {
  await userEvent.click(tabs()[1]);
}

/** Come back to your own. */
async function showMine() {
  await userEvent.click(tabs()[0]);
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
      myOpeningDelays={DUEL_OPENING}
      onPlay={props.onPlay}
      secondsLeft={secondsLeft}
      winningEdge={null}
    />,
  );
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
        myOpeningDelays={DUEL_OPENING}
        onPlay={() => {}}
      />,
    );
    expect(container.querySelectorAll('.move-btn--dimmed')).toHaveLength(4);
    expect(screen.getByRole('button', { name: /^Rock/ })).toHaveClass('move-btn--selected');
  });

  it('marks the move you locked in with a check, not just a colour (JQ-195)', () => {
    // The ring is --you blue and the dimming around it is a colour step too, so
    // without this the pick you committed to is a hue. The icon is the cue that
    // survives not seeing the hue.
    const { container } = renderPicker({ myChosenMove: 'rock', lockedIn: true, disabled: true });
    const rock = screen.getByRole('button', { name: /^Rock/ });
    expect(rock.querySelector('.move-btn__check')).not.toBeNull();
    expect(container.querySelectorAll('.move-btn__check')).toHaveLength(1);
  });

  it('writes the turns left on a blocked move, not only its dash (JQ-195)', () => {
    // The dashed border says "not this round". The pill says how many rounds,
    // which is the part a border cannot carry — and it says it in a number,
    // announced to assistive tech as a phrase rather than left to the glyph.
    const { container } = renderPicker({ myDelays: { paper: 2 } });
    const pill = container.querySelector('.move-btn--cooldown .cooldown-pill');
    expect(pill?.textContent).toContain('2');
    expect(pill?.getAttribute('aria-label')).toMatch(/2/);
  });
});

describe('<MovePicker> their cooldowns, on their own board (JQ 2.3, rehomed by JQ-324)', () => {
  it('fades the arrows leaving a move they cannot play, and no others', async () => {
    const { container } = renderPicker({ oppDelays: { robot: 2 } });
    await showTheirs();
    // Robot smashes Scissors & vaporizes Rock — neither attack is coming.
    expect(arrow(container, 'robot', 'rock')).toHaveClass('beat-arrow--off');
    expect(arrow(container, 'robot', 'scissors')).toHaveClass('beat-arrow--off');
    expect(container.querySelectorAll('.beat-arrow--off')).toHaveLength(2);
  });

  it('leaves a move nothing live can beat with no solid incoming arrow', async () => {
    const oppDelays = { paper: 1, robot: 2 };
    const { container } = renderPicker({ oppDelays });
    await showTheirs();

    expect(threatsTo('rock', oppDelays).safe).toBe(true);
    for (const line of incomingArrows(container, 'rock')) {
      expect(line).toHaveClass('beat-arrow--off');
    }

    // Lizard is still beaten by Rock and Scissors, both playable.
    expect(threatsTo('lizard', oppDelays).safe).toBe(false);
    expect(
      incomingArrows(container, 'lizard').some((l) => !l.classList.contains('beat-arrow--off')),
    ).toBe(true);
  });

  it('marks the node and names the wait when you tap it', async () => {
    renderPicker({ oppDelays: { robot: 2 }, oppName: 'Robin' });
    await showTheirs();
    await userEvent.click(screen.getByRole('button', { name: /^Robot/ }));
    expect(screen.getByText(/Robin can’t play it — back in 2 turns/)).toBeInTheDocument();
  });

  it('withholds "can\'t play" when the floor leaves them the move (JQ-215)', async () => {
    // Fully marked, with Paper and Lizard tied for fewest, so the floor keeps
    // both playable for them. Saying "can't play" here would be a false
    // all-clear the round itself disproves.
    renderPicker({ oppDelays: ALL_MARKED, oppName: 'Robin' });
    await showTheirs();
    await userEvent.click(screen.getByRole('button', { name: /^Paper/ }));
    expect(screen.queryByText(/can’t play it/)).toBeNull();
  });

  it('still shows it for a move the floor genuinely did not reach (JQ-215)', async () => {
    renderPicker({ oppDelays: ALL_MARKED, oppName: 'Robin' });
    await showTheirs();
    await userEvent.click(screen.getByRole('button', { name: /^Robot/ }));
    expect(screen.getByText(/Robin can’t play it — back in 4 turns/)).toBeInTheDocument();
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
    // Two stops: the tab strip above the board is one of them, and the board's
    // first move button is the next (JQ-324).
    await user.tab();
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
      winningEdge: { from: 'rock', to: 'scissors', role: 'you', added: false },
    });
    expect(arrow(container, 'rock', 'scissors')).toHaveClass('beat-arrow--won');
    expect(container.querySelectorAll('.beat-arrow--won')).toHaveLength(1);
  });

  it('carries the winner’s role so the arrow takes their colour', () => {
    const { container } = renderPicker({
      winningEdge: { from: 'robot', to: 'rock', role: 'opp', added: false },
    });
    expect(arrow(container, 'robot', 'rock')).toHaveClass('beat-arrow--won-opp');
  });

  // Phase 2 fades arrows leaving an opponent-cooldown node; the win must
  // still read as a win when it came from one.
  it('outranks the opponent-cooldown fade', () => {
    const { container } = renderPicker({
      oppDelays: { robot: 2 },
      winningEdge: { from: 'robot', to: 'rock', role: 'opp', added: false },
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
      winningEdge: { from: 'rock', to: 'scissors', role: 'you', added: false },
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
        myOpeningDelays={DUEL_OPENING}
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
    // Your own board's fades are your own dead attacks now, so this is the
    // sentence that has to match them (JQ-324).
    renderPicker({ myDelays: { lizard: 2 } });
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
      myOpeningDelays={DUEL_OPENING}
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

/**
 * Every move marked, two tied on the fewest. The server's floor makes Paper and
 * Lizard playable; the client used to grey out all five and refuse every tap.
 * Unreachable before JQ-210 gave the abilities something to do.
 */
const ALL_MARKED: Record<string, number> = {
  rock: 2,
  paper: 1,
  scissors: 3,
  lizard: 1,
  robot: 4,
};

describe('<MovePicker> a marked move can still be played (JQ-215)', () => {
  it('commits the least-marked move on the second tap', async () => {
    const user = userEvent.setup();
    const { onPlay } = renderPicker({ myDelays: ALL_MARKED });
    const paper = screen.getByRole('button', { name: /^Paper/ });
    await user.click(paper);
    expect(onPlay).not.toHaveBeenCalled(); // one tap is a preview, as ever
    await user.click(paper);
    expect(onPlay).toHaveBeenCalledWith('paper');
  });

  it('still refuses a move that is not among the least-marked', async () => {
    const user = userEvent.setup();
    const { onPlay } = renderPicker({ myDelays: ALL_MARKED });
    const robot = screen.getByRole('button', { name: /^Robot/ });
    await user.click(robot);
    await user.click(robot);
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('auto-commits a forced pick rather than letting it expire into a strike', async () => {
    // The whole point: the player has no clear move, so if the deadline path
    // declines to commit they take an expiry strike, and strikes forfeit.
    const user = userEvent.setup();
    const onPlay = vi.fn();
    const { rerender } = renderPicker({ onPlay, secondsLeft: 10, myDelays: ALL_MARKED });

    await user.click(screen.getByRole('button', { name: /^Lizard/ }));
    tickTo(rerender, 1, { onPlay, myDelays: ALL_MARKED });
    expect(onPlay).toHaveBeenCalledWith('lizard');
  });

  it('does not auto-commit a move the floor did not reach', async () => {
    const user = userEvent.setup();
    const onPlay = vi.fn();
    const { rerender } = renderPicker({ onPlay, secondsLeft: 10, myDelays: ALL_MARKED });

    await user.click(screen.getByRole('button', { name: /^Scissors/ }));
    tickTo(rerender, 1, { onPlay, myDelays: ALL_MARKED });
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('paints a forced pick as playable, not as blocked', () => {
    const { container } = renderPicker({ myDelays: ALL_MARKED });
    const paper = screen.getByRole('button', { name: /^Paper/ });
    expect(paper).toHaveClass('move-btn--forced');
    expect(paper).not.toHaveClass('move-btn--cooldown');
    expect(paper).not.toHaveAttribute('aria-disabled');
    // Still marked, so it still carries its count — but the pill no longer
    // says "on cooldown" about a move you can play.
    expect(within(paper).getByText('1', { selector: '.cooldown-pill' })).toBeInTheDocument();
    expect(paper.querySelector('.cooldown-pill')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByLabelText('on cooldown, 1 turn')).toBeNull();
    // And the moves the floor did not reach are unchanged.
    const robot = screen.getByRole('button', { name: /^Robot/ });
    expect(robot).toHaveClass('move-btn--cooldown');
    expect(robot).not.toHaveClass('move-btn--forced');
    expect(robot).toHaveAttribute('aria-disabled', 'true');
    expect(container.querySelectorAll('.move-btn--forced')).toHaveLength(2);
  });

  it('says in words that it is playable and costs more', () => {
    renderPicker({ myDelays: ALL_MARKED });
    // Not colour-only: the same sentence the sighted player reads off the pill
    // and the centre has to reach a screen reader too.
    expect(
      screen.getByRole('button', { name: /^Paper, marked but playable, costs you more/ }),
    ).toBeInTheDocument();
  });

  it('offers Lock in and names the cost qualitatively in the centre', async () => {
    const user = userEvent.setup();
    const { container } = renderPicker({ myDelays: ALL_MARKED });
    await user.click(screen.getByRole('button', { name: /^Paper/ }));
    const centre = container.querySelector('.picker-center') as HTMLElement;
    expect(centre).toHaveTextContent('Every move is marked — Paper is your cheapest.');
    expect(centre).toHaveTextContent('Playing it puts it further down.');
    expect(container.querySelector('.picker-center--why')).toBeNull();
    expect(screen.getByRole('button', { name: /^Lock in Paper/ })).toBeInTheDocument();
  });

  it('still explains a move the floor did not reach', async () => {
    const user = userEvent.setup();
    const { container } = renderPicker({ myDelays: ALL_MARKED });
    await user.click(screen.getByRole('button', { name: /^Robot/ }));
    expect(container.querySelector('.picker-center--why')).toHaveTextContent('back in 4 turns');
    expect(screen.queryByRole('button', { name: /^Lock in/ })).not.toBeInTheDocument();
  });

  it('leaves an ordinary round exactly as it was', () => {
    // Criterion 4. One move on zero is every duel round and nearly every
    // helpers round; the new state must be unreachable there.
    const { container } = renderPicker({ myDelays: { rock: 0, lizard: 1, robot: 2 } });
    expect(container.querySelector('.move-btn--forced')).toBeNull();
    expect(screen.getByRole('button', { name: /^Lizard/ })).toHaveClass('move-btn--cooldown');
    expect(screen.getByRole('button', { name: /^Robot/ })).toHaveClass('move-btn--cooldown');
    expect(container.querySelectorAll('.move-btn--cooldown')).toHaveLength(2);
  });

  it('does not fade every arrow when the opponent is fully marked', async () => {
    const { container } = renderPicker({ oppDelays: ALL_MARKED });
    await showTheirs();
    // Paper and Lizard are their least-marked, so their attacks are live.
    expect(arrow(container, 'paper', 'rock')).not.toHaveClass('beat-arrow--off');
    expect(arrow(container, 'lizard', 'robot')).not.toHaveClass('beat-arrow--off');
    expect(arrow(container, 'robot', 'rock')).toHaveClass('beat-arrow--off');
  });

  /**
   * A forced pick, already locked in. Unreachable until JQ-150 made the seat's
   * own move survive a reload — `currentRoundMoves` was stripped from every
   * snapshot, so a mid-round reload came back looking unlocked and `lockedIn`
   * plus a marked move could not co-occur. It can now.
   */
  it('reads as your pick, not as a cost, once it is locked in', () => {
    const { container } = renderPicker({
      myDelays: ALL_MARKED,
      myChosenMove: 'paper',
      lockedIn: true,
      disabled: true,
    });
    const paper = screen.getByRole('button', { name: /^Paper/ });
    // Still marked, so still forced — but `--selected` is declared after
    // `--forced` in styles.css and both are single-class, so the border reads
    // in your colour rather than warn. The pick outranks the price.
    expect(paper).toHaveClass('move-btn--forced');
    expect(paper).toHaveClass('move-btn--selected');
    expect(paper).not.toHaveClass('move-btn--dimmed');
    // The centre is the wait, not the sales pitch: "puts it further down" is a
    // decision you have already taken.
    expect(container.querySelector('.picker-center--waiting')).toBeInTheDocument();
    expect(container.querySelector('.picker-center__forced')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Lock in/ })).not.toBeInTheDocument();
  });
});

/**
 * The sixth edge, and the numbers on their marks (JQ-151).
 *
 * The comprehension risk this ticket names is that a conditional graph makes every
 * arrow ask "whose?". These hold the answer to that question visible: the extra
 * edge is drawn, attributed, and drawn on *both* screens — the opponent has to be
 * able to see the rule they are playing against.
 */
const CHIMERA_BEATS = { ...SHARED_BEATS, lizard: ['robot', 'paper', 'scissors'] as Move[] };

/** The `<path>` for an added edge, e.g. lizard → scissors. */
function addedArrow(container: HTMLElement, from: Move, to: Move): SVGPathElement | null {
  return container.querySelector<SVGPathElement>(
    `path[data-added-from="${from}"][data-added-to="${to}"]`,
  );
}

describe('an edge a loadout added', () => {
  it('draws none at all in a duel, leaving the ten shared edges alone', () => {
    const { container } = renderPicker();
    expect(container.querySelectorAll('path[data-added-from]')).toHaveLength(0);
    expect(container.querySelectorAll('line[data-from]')).toHaveLength(10);
  });

  it('draws the owner’s extra edge in their own role colour', () => {
    const { container } = renderPicker({ myBeats: CHIMERA_BEATS });
    const edge = addedArrow(container, 'lizard', 'scissors');
    expect(edge).not.toBeNull();
    expect(edge).toHaveClass('beat-arrow--added', 'beat-arrow--added-you');
    expect(edge?.getAttribute('marker-end')).toBe('url(#rps-arrow-you)');
  });

  // The whole point of the ticket: a rule you are playing against is no use to you
  // unrendered. It appears on the opponent's screen too, in *their* colour.
  it('draws it on the opponent’s own board, marked as theirs', async () => {
    // Still reachable, still theirs — one tab away rather than on top of your
    // own rules (JQ-324).
    const { container } = renderPicker({ oppBeats: CHIMERA_BEATS });
    await showTheirs();
    const edge = addedArrow(container, 'lizard', 'scissors');
    expect(edge).toHaveClass('beat-arrow--added-opp');
    expect(edge?.getAttribute('marker-end')).toBe('url(#rps-arrow-opp)');
  });

  // Straight, it would land exactly on `scissors → lizard` and the board would
  // show one line with a head at each end — "these two beat each other".
  it('curves, so it does not sit on the arrow pointing the other way', () => {
    const { container } = renderPicker({ myBeats: CHIMERA_BEATS });
    expect(addedArrow(container, 'lizard', 'scissors')?.getAttribute('d')).toMatch(/^M .* Q .*/);
    // And the shared edge it reverses is still there, still straight.
    expect(arrow(container, 'scissors', 'lizard')).toBeTruthy();
  });

  it('fades an edge of theirs off a move they cannot play this round', async () => {
    const { container } = renderPicker({ oppBeats: CHIMERA_BEATS, oppDelays: { lizard: 2 } });
    await showTheirs();
    expect(addedArrow(container, 'lizard', 'scissors')).toHaveClass('beat-arrow--off');
  });

  it('lights the curve when the round was won on it', () => {
    const { container } = renderPicker({
      myBeats: CHIMERA_BEATS,
      winningEdge: { from: 'lizard', to: 'scissors', role: 'you', added: true },
    });
    expect(addedArrow(container, 'lizard', 'scissors')).toHaveClass('beat-arrow--won');
  });

  it('previews the extra target along with the two shared ones', async () => {
    const user = userEvent.setup();
    const { container } = renderPicker({ myBeats: CHIMERA_BEATS });
    await user.click(screen.getByRole('button', { name: /^Lizard/ }));
    for (const target of ['Paper', 'Robot', 'Scissors']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${target}`) })).toHaveClass(
        'move-btn--target',
      );
    }
    expect(center(container)).toHaveTextContent('Lizard eats Paper, poisons Robot & beats Scissors');
  });

  it('says the extra edge out loud for anyone who cannot see it', () => {
    renderPicker({ myBeats: CHIMERA_BEATS });
    const graph = screen.getByRole('region', { name: 'What beats what' });
    expect(within(graph).getByText('Your Lizard also beats Scissors this match')).toBeTruthy();
  });
});

describe('the legend gains at most one entry', () => {
  const legend = (container: HTMLElement) =>
    container.querySelector('.graph-legend') as HTMLElement;

  it('stays at one entry in a duel', () => {
    const { container } = renderPicker();
    expect(legend(container).querySelector('.graph-legend__added')).toBeNull();
    expect(legend(container)).not.toHaveTextContent('curved');
  });

  it('gains exactly one when a loadout added an edge', () => {
    const { container } = renderPicker({ myBeats: CHIMERA_BEATS });
    expect(legend(container).querySelectorAll('.graph-legend__added')).toHaveLength(1);
    expect(legend(container)).toHaveTextContent('curved = extra rule');
  });

  // One board at a time, so one owner's curve at a time — the entry explains the
  // *shape*, and which board you are on says whose it is (JQ-324).
  it('does not gain a second when both players have one', () => {
    const { container } = renderPicker({ myBeats: CHIMERA_BEATS, oppBeats: CHIMERA_BEATS });
    expect(legend(container).querySelectorAll('.graph-legend__added')).toHaveLength(1);
  });

  /**
   * `TEXT.legend` in boardFit.test.ts is a Chromium measurement of this copy at
   * ONE line, at 360, 375 and 390px. jsdom does no layout, so the guard here is
   * the copy itself: growing it means re-measuring that constant, and a second
   * line is the tab strip's height, which the page has no room to give twice.
   */
  it('holds the measured copy, so a second line cannot arrive unnoticed', () => {
    const { container } = renderPicker({ myBeats: CHIMERA_BEATS });
    expect(legend(container).textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'N cooldown · faded = can’t attack · curved = extra rule',
    );
  });

  it('reads the same on either board, because the tab says whose it is', async () => {
    const { container } = renderPicker({ oppName: 'Robin' });
    const mine = legend(container).textContent?.replace(/\s+/g, ' ').trim();
    await showTheirs();
    expect(legend(container).textContent?.replace(/\s+/g, ' ').trim()).toBe(mine);
    expect(tabs()[1]).toHaveTextContent(/Robin's moves/);
  });
});

describe('their cooldowns, on their own board (JQ-324)', () => {
  /** The pill on a node — not the one in the legend, which teaches it. */
  const pill = (container: HTMLElement) =>
    container.querySelector('.move-btn .cooldown-pill') as HTMLElement;

  // The count used to be withheld in a duel: their badge shared a node with your
  // own state, and a number there restated what the history strip already said.
  // Their board is their own now, so the pill reads exactly like yours does.
  it('carries their count in a duel as well as in helpers', async () => {
    const { container } = renderPicker({ oppDelays: { rock: 2 } });
    await showTheirs();
    expect(pill(container)).toHaveClass('cooldown-pill--theirs');
    expect(pill(container).textContent).toContain('2');
  });

  it('keeps their marks off your own board entirely', () => {
    const { container } = renderPicker({ oppDelays: { rock: 2 } });
    expect(container.querySelector('.move-btn .cooldown-pill')).toBeNull();
    expect(container.querySelector('.opp-cooldown-mark')).toBeNull();
  });

  it('names whose cooldown it is in the spoken label', async () => {
    renderPicker({ oppDelays: { rock: 4 }, oppName: 'Robin' });
    await showTheirs();
    expect(screen.getByRole('button', { name: /Rock, Robin can't play it, on cooldown, 4 turns/ }))
      .toBeInTheDocument();
  });
});

describe('a cooldown says what actually caused it', () => {
  const why = (container: HTMLElement) =>
    container.querySelector('.picker-center__why')?.textContent?.replace(/\s+/g, ' ').trim();

  it('blames your own pick when that is what did it', async () => {
    const user = userEvent.setup();
    const { container } = renderPicker({ myDelays: { rock: 2 }, myRecentMoves: ['rock'] });
    await user.click(screen.getByRole('button', { name: /^Rock/ }));
    expect(why(container)).toBe('You played Rock last round — back in 2 turns');
  });

  // The lie this ticket exists to remove: Paper is down because they put it down,
  // and "You played Paper last round" over the top of that is confidently wrong.
  it('names the opponent and their card when they inflicted it', async () => {
    const user = userEvent.setup();
    const { container } = renderPicker({
      myDelays: { paper: 2 },
      myRecentMoves: ['rock'],
      myLedger: [
        {
          round: 0,
          side: 'a',
          move: 'paper',
          amount: 2,
          cause: { kind: 'helper', helperId: 'quarantine', mine: false },
        },
      ],
    });
    await user.click(screen.getByRole('button', { name: /^Paper/ }));
    expect(why(container)).toBe('Their Quarantine put 2 marks on Paper — back in 2 turns');
  });

  // Freeze stops marks coming off, so nothing promises a turn count against a
  // loadout that holds it.
  it('stops promising turns when the opponent can freeze the decrement', async () => {
    const user = userEvent.setup();
    const { container } = renderPicker({
      myDelays: { rock: 2 },
      myRecentMoves: ['rock'],
      oppCanFreeze: true,
    });
    await user.click(screen.getByRole('button', { name: /^Rock/ }));
    expect(why(container)).toBe('You played Rock last round — 2 marks to clear');
  });

  it('carries the same cause into the spoken label', () => {
    renderPicker({
      myDelays: { paper: 2 },
      myLedger: [
        {
          round: 0,
          side: 'a',
          move: 'paper',
          amount: 2,
          cause: { kind: 'helper', helperId: 'rust', mine: false },
        },
      ],
    });
    expect(screen.getByRole('button', { name: /their rust put 2 marks on paper/ })).toBeTruthy();
  });
});

describe('<MovePicker> switching between the two views (JQ-324)', () => {
  it('opens on your own moves', () => {
    renderPicker();
    expect(tabs()[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('cannot commit a move, however many times you switch', async () => {
    const { onPlay } = renderPicker();
    await userEvent.click(screen.getByRole('button', { name: /^Rock/ }));
    await showTheirs();
    await showMine();
    await showTheirs();
    await showMine();
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('keeps a pending choice across a switch', async () => {
    renderPicker();
    await userEvent.click(screen.getByRole('button', { name: /^Rock/ }));
    await showTheirs();
    await showMine();
    expect(screen.getByRole('button', { name: /Lock in Rock/ })).toBeInTheDocument();
  });

  it('resets the second-tap-to-commit sequence across a switch', async () => {
    // Coming back to a board you left has to read as arriving at it, not as
    // being one tap from having played: the tap that committed before the
    // switch is not the tap in front of you now.
    const { onPlay } = renderPicker();
    await userEvent.click(screen.getByRole('button', { name: /^Rock/ }));
    await showTheirs();
    await showMine();
    await userEvent.click(screen.getByRole('button', { name: /^Rock/ }));
    expect(onPlay).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /^Rock/ }));
    expect(onPlay).toHaveBeenCalledWith('rock');
  });

  it('keeps the explicit Lock in working after a switch', async () => {
    const { onPlay } = renderPicker();
    await userEvent.click(screen.getByRole('button', { name: /^Rock/ }));
    await showTheirs();
    await showMine();
    await userEvent.click(screen.getByRole('button', { name: /Lock in Rock/ }));
    expect(onPlay).toHaveBeenCalledWith('rock');
  });

  it('returns to your moves on a new round', () => {
    const { rerenderWith } = renderPicker({ round: 3 });
    fireEvent.click(tabs()[1]);
    expect(tabs()[1]).toHaveAttribute('aria-selected', 'true');
    rerenderWith({ round: 4 });
    expect(tabs()[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('leaves the view alone when state refreshes without a new round', async () => {
    // A board that jumped back to your own every time the opponent's readiness
    // arrived would make an inspection impossible to finish.
    const { rerenderWith } = renderPicker({ round: 3, opponentLockedIn: false });
    await showTheirs();
    rerenderWith({ round: 3, opponentLockedIn: true });
    expect(tabs()[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('never lets an inspection become the move the clock commits', async () => {
    // The auto-commit plays what you tapped just before the deadline. What you
    // tapped on *their* board is a question, not a choice.
    const { onPlay, rerenderWith } = renderPicker({ secondsLeft: 10 });
    await userEvent.click(screen.getByRole('button', { name: /^Rock/ }));
    await showTheirs();
    await userEvent.click(screen.getByRole('button', { name: /^Paper/ }));
    rerenderWith({ secondsLeft: 1 });
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('still auto-commits your own tapped move once you are back', async () => {
    const { onPlay, rerenderWith } = renderPicker({ secondsLeft: 10 });
    await userEvent.click(screen.getByRole('button', { name: /^Rock/ }));
    await showTheirs();
    await showMine();
    rerenderWith({ secondsLeft: 1 });
    expect(onPlay).toHaveBeenCalledWith('rock');
  });

  it('accepts no input on either board once you have locked in', async () => {
    const { onPlay } = renderPicker({ lockedIn: true, myChosenMove: 'rock', disabled: true });
    await showTheirs();
    await userEvent.click(screen.getByRole('button', { name: /^Paper/ }));
    await showMine();
    await userEvent.click(screen.getByRole('button', { name: /^Paper/ }));
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('points the tabs at the board they switch', () => {
    const { container } = renderPicker();
    const panel = container.querySelector('[role="tabpanel"]') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(tabs()[0]).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', tabs()[0].id);
  });

  it('takes Escape back to your own moves', async () => {
    renderPicker();
    await showTheirs();
    await userEvent.keyboard('{Escape}');
    expect(tabs()[0]).toHaveAttribute('aria-selected', 'true');
  });
});

describe('<MovePicker> focus order (JQ-324)', () => {
  it('spends one stop on the strip before the board', async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.tab();
    expect(document.activeElement).toBe(tabs()[0]);
    await user.tab();
    expect(document.activeElement).toHaveClass('move-btn');
  });

  it('drops the controls of the board you are not on out of the focus order', async () => {
    const { container } = renderPicker();
    await userEvent.click(screen.getByRole('button', { name: /^Rock/ }));
    expect(container.querySelector('.picker-center__lock')).not.toBeNull();
    await showTheirs();
    // Lock in belongs to your board. While theirs is open it is not hidden from
    // view by CSS — it is not in the tree at all, so nothing can tab to it.
    expect(container.querySelector('.picker-center__lock')).toBeNull();
  });
});

describe('<MovePicker> each view draws only its own player (JQ-324)', () => {
  it('drops the opponent fade from your own board', () => {
    // The fade is the viewed player's own dead attacks now. On your board with
    // every move of yours live, nothing is faded however marked they are.
    const { container } = renderPicker({ oppDelays: { scissors: 2, lizard: 2 } });
    expect(container.querySelectorAll('.beat-arrow--off')).toHaveLength(0);
  });

  it('fades the arrows leaving a move you cannot play', () => {
    const { container } = renderPicker({ myDelays: { lizard: 2 } });
    const off = [...container.querySelectorAll('.beat-arrow--off')];
    expect(off).not.toHaveLength(0);
    expect(off.every((a) => a.getAttribute('data-from') === 'lizard')).toBe(true);
  });

  it('fades the arrows leaving a move they cannot play, on their board', async () => {
    const { container } = renderPicker({ oppDelays: { lizard: 2 } });
    await showTheirs();
    const off = [...container.querySelectorAll('.beat-arrow--off')];
    expect(off).not.toHaveLength(0);
    expect(off.every((a) => a.getAttribute('data-from') === 'lizard')).toBe(true);
  });

  it('lights every outgoing edge of a move you preview, live or not', async () => {
    // The caption says "Rock crushes Scissors & Lizard". Dropping the Lizard
    // arrow because they cannot play it this round would put the board and the
    // caption in disagreement, which is worse than saying less.
    const { container } = renderPicker({ oppDelays: { lizard: 3 } });
    await userEvent.click(screen.getByRole('button', { name: /^Rock/ }));
    expect(arrow(container, 'rock', 'scissors')).toHaveClass('beat-arrow--preview');
    expect(arrow(container, 'rock', 'lizard')).toHaveClass('beat-arrow--preview');
  });

  it('shows their cooldown, and yours nowhere on it', async () => {
    const { container } = renderPicker({ myDelays: { rock: 2 }, oppDelays: { paper: 3 } });
    await showTheirs();
    const pills = [...container.querySelectorAll('.move-btn .cooldown-pill')];
    expect(pills).toHaveLength(1);
    expect(pills[0].textContent).toContain('3');
  });

  it('offers no commitment on their board', async () => {
    const { onPlay, container } = renderPicker();
    await showTheirs();
    await userEvent.click(screen.getByRole('button', { name: /^Rock/ }));
    await userEvent.click(screen.getByRole('button', { name: /^Rock/ }));
    expect(onPlay).not.toHaveBeenCalled();
    expect(container.querySelector('.picker-center__lock')).toBeNull();
    expect(screen.getByRole('button', { name: /^Rock/ })).not.toHaveAttribute('aria-pressed');
  });

  it('keeps your locked-in check off their board', async () => {
    const { container } = renderPicker({ lockedIn: true, myChosenMove: 'rock' });
    expect(container.querySelector('.move-btn--selected')).not.toBeNull();
    await showTheirs();
    expect(container.querySelector('.move-btn--selected')).toBeNull();
  });

  it('draws each owner’s added edge on that owner’s board', async () => {
    const { container } = renderPicker({ oppBeats: CHIMERA_BEATS });
    expect(container.querySelector('[data-added-from="lizard"]')).toBeNull();
    await showTheirs();
    expect(container.querySelector('[data-added-from="lizard"]')).not.toBeNull();
  });

  it('keeps the five positions and the button count in both views', async () => {
    const { container } = renderPicker();
    const before = [...container.querySelectorAll('.move-btn')].map(
      (b) => `${(b as HTMLElement).style.left}/${(b as HTMLElement).style.top}`,
    );
    await showTheirs();
    const after = [...container.querySelectorAll('.move-btn')].map(
      (b) => `${(b as HTMLElement).style.left}/${(b as HTMLElement).style.top}`,
    );
    expect(after).toEqual(before);
    expect(after).toHaveLength(5);
  });

  it('says whose options are being read, and only theirs', async () => {
    renderPicker({ myDelays: { rock: 2 }, oppDelays: { lizard: 2 }, oppName: 'Robin' });
    const graph = () => screen.getByRole('region', { name: /what beats what/i });
    expect(within(graph()).getByText(/^You can't play Rock this round/)).toBeInTheDocument();
    await showTheirs();
    expect(within(graph()).getByText(/^Robin can't play Lizard this round/)).toBeInTheDocument();
  });

  it('speaks in names on a replay, where there is no you', async () => {
    renderPicker({ voice: spectatorVoice('Ada'), myDelays: { rock: 2 }, oppName: 'Robin' });
    expect(screen.getAllByRole('tab')[0]).toHaveTextContent(/Ada's moves/);
    const graph = screen.getByRole('region', { name: /what beats what/i });
    expect(within(graph).getByText(/^You can't play Rock this round/)).toBeInTheDocument();
  });
});

describe('<MovePicker> inspecting their board (JQ-324)', () => {
  const theirCenter = (container: HTMLElement) =>
    container.querySelector('.picker-center--theirs') as HTMLElement;

  it('prompts before anything is tapped', async () => {
    const { container } = renderPicker({ oppName: 'Robin' });
    await showTheirs();
    expect(within(theirCenter(container)).getByText(/Tap one of Robin’s moves/)).toBeInTheDocument();
  });

  it('explains one of their moves in their terms', async () => {
    const { container } = renderPicker({ oppDelays: { scissors: 2 }, oppName: 'Robin' });
    await showTheirs();
    await userEvent.click(screen.getByRole('button', { name: /^Scissors/ }));
    expect(
      within(theirCenter(container)).getByText('Scissors cuts Paper & decapitates Lizard'),
    ).toBeInTheDocument();
    expect(within(theirCenter(container)).getByText(/back in 2 turns/)).toBeInTheDocument();
  });

  it('reads a tapped move through their graph, not yours', async () => {
    const { container } = renderPicker({ oppBeats: CHIMERA_BEATS });
    await showTheirs();
    await userEvent.click(screen.getByRole('button', { name: /^Lizard/ }));
    expect(
      within(theirCenter(container)).getByText('Lizard eats Paper, poisons Robot & beats Scissors'),
    ).toBeInTheDocument();
  });

  it('states the matchup, and whose it is, once you are carrying a pick', async () => {
    const { container } = renderPicker({ oppName: 'Robin' });
    await userEvent.click(screen.getByRole('button', { name: /^Rock/ }));
    await showTheirs();
    await userEvent.click(screen.getByRole('button', { name: /^Paper/ }));
    expect(
      within(theirCenter(container)).getByText(/Paper covers Rock — Robin wins/),
    ).toBeInTheDocument();
  });

  it('gives an asymmetric pair to the side that actually holds the edge', async () => {
    // Their Chimera Lizard takes your Scissors, though the shared graph says
    // Scissors decapitates Lizard. The round would give it to them, so this does.
    const { container } = renderPicker({ oppBeats: CHIMERA_BEATS, oppName: 'Robin' });
    await userEvent.click(screen.getByRole('button', { name: /^Scissors/ }));
    await showTheirs();
    await userEvent.click(screen.getByRole('button', { name: /^Lizard/ }));
    expect(
      within(theirCenter(container)).getByText(/Lizard beats Scissors — Robin wins/),
    ).toBeInTheDocument();
  });

  it('says nothing about the matchup before you have picked', async () => {
    const { container } = renderPicker();
    await showTheirs();
    await userEvent.click(screen.getByRole('button', { name: /^Paper/ }));
    expect(theirCenter(container).querySelector('.picker-center__matchup')).toBeNull();
  });

  it('lights only the edges your pick shares with a move they can play', async () => {
    const { container } = renderPicker({ oppDelays: { scissors: 3 } });
    await userEvent.click(screen.getByRole('button', { name: /^Rock/ }));
    await showTheirs();
    const live = [...container.querySelectorAll('.beat-arrow--matchup')].map((a) => [
      a.getAttribute('data-from'),
      a.getAttribute('data-to'),
    ]);
    expect(live).toContainEqual(['rock', 'lizard']);
    expect(live).not.toContainEqual(['rock', 'scissors']);
    expect(live).toContainEqual(['paper', 'rock']);
  });

  it('colours a matchup arrow for whoever would take it', async () => {
    const { container } = renderPicker();
    await userEvent.click(screen.getByRole('button', { name: /^Rock/ }));
    await showTheirs();
    expect(arrow(container, 'rock', 'lizard')).toHaveClass('beat-arrow--matchup-you');
    expect(arrow(container, 'paper', 'rock')).toHaveClass('beat-arrow--matchup-opp');
  });

  it('draws no matchup arrows on your own board', async () => {
    const { container } = renderPicker();
    await userEvent.click(screen.getByRole('button', { name: /^Rock/ }));
    expect(container.querySelectorAll('.beat-arrow--matchup')).toHaveLength(0);
  });

  it('offers a way back that commits nothing', async () => {
    const { onPlay } = renderPicker();
    await userEvent.click(screen.getByRole('button', { name: /^Rock/ }));
    await showTheirs();
    await userEvent.click(screen.getByRole('button', { name: /Back to your moves/ }));
    expect(onPlay).not.toHaveBeenCalled();
    expect(tabs()[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: /Lock in Rock/ })).toBeInTheDocument();
  });

  it('says nothing about the move they have actually chosen', async () => {
    renderPicker({ opponentLockedIn: true, oppName: 'Robin' });
    await showTheirs();
    expect(screen.queryByText(/Robin picked|their move is|has chosen/i)).toBeNull();
  });

  it('puts an inspection away when you tap it again', async () => {
    const { container } = renderPicker({ oppName: 'Robin' });
    await showTheirs();
    await userEvent.click(screen.getByRole('button', { name: /^Paper/ }));
    expect(within(theirCenter(container)).queryByText(/Tap one of Robin’s moves/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /^Paper/ }));
    expect(within(theirCenter(container)).getByText(/Tap one of Robin’s moves/)).toBeInTheDocument();
  });
});

describe('<MovePicker> their board says nothing about yours (JQ-324)', () => {
  it('leaves your one-time notes on your own board', async () => {
    const { container } = renderPicker({
      round: 1,
      myDelays: { scissors: 2 },
      myRecentMoves: ['scissors'],
    });
    expect(container.querySelector('.picker-note')).not.toBeNull();
    await showTheirs();
    // "Tap to preview, tap again to lock in" and "you played Scissors last
    // round" are both about a board that is not open.
    expect(container.querySelector('.picker-note')).toBeNull();
  });

  it('marks what one of their moves would take, not what you chose', async () => {
    const { container } = renderPicker({ oppDelays: { paper: 2, lizard: 1 } });
    await showTheirs();
    await userEvent.click(screen.getByRole('button', { name: /^Paper/ }));
    expect(
      [...container.querySelectorAll('.move-btn--target')].map((b) => b.textContent),
    ).toEqual(['Rock', 'Robot']);
    expect(container.querySelector('.move-btn--selected')).toBeNull();
  });
});

/**
 * A walk, as `useAbilityTargeting` hands it over. Built from the real
 * `targetSteps` so the prompt and the rejection are the card's own words rather
 * than this file's guess at them.
 */
function rustTargeting(over: Partial<Targeting> = {}): Targeting {
  const step = targetSteps('rust')[0];
  return {
    helperId: 'rust',
    name: 'Rust',
    step,
    named: {},
    side: 'opponent',
    legal: ['scissors'],
    instruction: 'Choose one of their moves for Rust',
    prompt: step.prompt,
    rejection: step.rejection,
    ...over,
  };
}

/** The open board, as the tabpanel reports it. */
function openView(container: HTMLElement): string | null {
  return container.querySelector('.move-board')!.getAttribute('data-view');
}

describe('<MovePicker> an ability naming a move takes the board (JQ-325)', () => {
  /*
   * AC #2. JQ-221 kept targeting off the pentagon because the pentagon was
   * always the commit surface. JQ-324 made the opponent's board something else
   * entirely, and this mode makes your own board something else too for as long
   * as it runs — which is what makes the reversal safe rather than merely
   * allowed.
   */
  it('opens the board the step names, whatever was open before', () => {
    const { container } = renderPicker({ targeting: rustTargeting() });
    expect(openView(container)).toBe('theirs');
    expect(container.querySelector('.move-board')).toHaveAttribute('data-targeting');
    expect(screen.getByText('Choose one of their moves for Rust')).toBeInTheDocument();
  });

  it("keeps the card's own words, which are the only place the pair differ", () => {
    renderPicker({ targeting: rustTargeting() });
    expect(screen.getByText(/name a move they have on cooldown/i)).toBeInTheDocument();
  });

  /* AC #5. */
  it('holds the tabs, and a tap on one cannot move the board', async () => {
    const { container } = renderPicker({ targeting: rustTargeting() });
    for (const tab of tabs()) expect(tab).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(tabs()[0]);
    expect(openView(container)).toBe('theirs');
  });

  it('follows the walk to the other board between steps', () => {
    const source = targetSteps('thief')[0];
    const { container, rerenderWith } = renderPicker({
      myDelays: { rock: 1 },
      targeting: {
        helperId: 'thief',
        name: 'Thief',
        step: source,
        named: {},
        side: 'own',
        legal: ['rock'],
        instruction: 'Choose one of your moves for Thief',
        prompt: source.prompt,
        rejection: source.rejection,
      },
    });
    expect(openView(container)).toBe('mine');

    const target = targetSteps('thief')[1];
    rerenderWith({
      targeting: {
        helperId: 'thief',
        name: 'Thief',
        step: target,
        named: { source: 'rock' },
        side: 'opponent',
        legal: ['rock', 'paper', 'scissors', 'lizard', 'robot'],
        instruction: 'Choose one of their moves for Thief',
        prompt: target.prompt,
        rejection: target.rejection,
      },
    });
    expect(openView(container)).toBe('theirs');
    expect(screen.getByText(/so far: taking a mark from your rock/i)).toBeInTheDocument();
  });
});

describe('<MovePicker> a target is not a move (JQ-325, AC #3)', () => {
  it('names the target and plays nothing', async () => {
    const onNameTarget = vi.fn();
    const { onPlay } = renderPicker({ targeting: rustTargeting(), onNameTarget });
    await userEvent.click(screen.getByRole('button', { name: /^Scissors/ }));
    expect(onNameTarget).toHaveBeenCalledWith('scissors');
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('refuses an illegal target and says why, out loud', async () => {
    const onNameTarget = vi.fn();
    renderPicker({ targeting: rustTargeting(), onNameTarget });
    const rock = screen.getByRole('button', { name: /^Rock/ });
    expect(rock).toBeDisabled();
    expect(rock).toHaveAccessibleDescription(
      /Rock is clear — Rust needs a move they have on cooldown/i,
    );
    await userEvent.click(rock);
    expect(onNameTarget).not.toHaveBeenCalled();
  });

  it('offers no way to commit the round while it runs', () => {
    renderPicker({ targeting: rustTargeting() });
    expect(screen.queryByRole('button', { name: /Lock in/ })).not.toBeInTheDocument();
  });

  /*
   * A seat that has locked its move may still fire — `firingUnavailable` says
   * nothing about having picked — so the round's own `disabled` must not close
   * the board to the step.
   */
  it('still takes a target after you have locked your move in', () => {
    renderPicker({
      disabled: true,
      lockedIn: true,
      myChosenMove: 'rock',
      targeting: rustTargeting(),
    });
    expect(screen.getByRole('button', { name: /^Scissors/ })).toBeEnabled();
  });

  it('does not let the clock play your pick while a target is open', () => {
    const { onPlay, rerenderWith } = renderPicker({ secondsLeft: 10 });
    fireEvent.click(screen.getByRole('button', { name: /^Rock/ }));
    rerenderWith({ targeting: rustTargeting(), secondsLeft: 1 });
    expect(onPlay).not.toHaveBeenCalled();
  });
});

describe('<MovePicker> cancelling and firing (JQ-325, AC #4, AC #6)', () => {
  it('keeps your tentative pick right through a walk', () => {
    const { rerenderWith } = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /^Rock/ }));
    rerenderWith({ targeting: rustTargeting() });
    expect(screen.queryByRole('button', { name: /Lock in Rock/ })).not.toBeInTheDocument();
    // Cancelled: the walk goes away and the board it was covering is still there,
    // with the choice that was on it.
    rerenderWith({ targeting: null });
    expect(screen.getByRole('button', { name: /Lock in Rock/ })).toBeInTheDocument();
  });

  it('restores the board you came from, not your own', () => {
    const { container, rerenderWith } = renderPicker();
    fireEvent.click(tabs()[1]);
    rerenderWith({ targeting: rustTargeting({ side: 'own', legal: ['rock'] }) });
    expect(openView(container)).toBe('mine');
    rerenderWith({ targeting: null });
    expect(openView(container)).toBe('theirs');
  });

  it('cancels on Escape', async () => {
    const onCancelTargeting = vi.fn();
    renderPicker({ targeting: rustTargeting(), onCancelTargeting });
    await userEvent.keyboard('{Escape}');
    expect(onCancelTargeting).toHaveBeenCalledTimes(1);
  });

  it('says plainly on the confirm step that a fired charge does not come back', () => {
    renderPicker({ targeting: rustTargeting({ step: null, named: { target: 'scissors' } }) });
    expect(screen.getByText(/Fire Rust, naming their Scissors\?/)).toBeInTheDocument();
    expect(screen.getByText(/can't be taken back/i)).toBeInTheDocument();
    expect(screen.getByText(/spent whether or not it lands/i)).toBeInTheDocument();
  });

  it('fires once, and hands the board back to your own moves', async () => {
    const onConfirmTargeting = vi.fn();
    const { container, rerenderWith } = renderPicker({
      targeting: rustTargeting({ step: null, named: { target: 'scissors' } }),
      onConfirmTargeting,
    });
    await userEvent.click(screen.getByRole('button', { name: /^Fire$/ }));
    expect(onConfirmTargeting).toHaveBeenCalledTimes(1);
    rerenderWith({ targeting: null });
    expect(openView(container)).toBe('mine');
  });
});

describe('<MovePicker> a window takes the board back (JQ-325, AC #7)', () => {
  it('opens your own moves when a window you may act in arrives', () => {
    const { container, rerenderWith } = renderPicker();
    fireEvent.click(tabs()[1]);
    expect(openView(container)).toBe('theirs');
    rerenderWith({ demandOwnBoard: 3 });
    expect(openView(container)).toBe('mine');
  });

  it('does it once, not on every refresh of the same window', () => {
    const { container, rerenderWith } = renderPicker();
    rerenderWith({ demandOwnBoard: 3 });
    // The player has looked at the window and gone back to read their board.
    fireEvent.click(tabs()[1]);
    expect(openView(container)).toBe('theirs');
    rerenderWith({ demandOwnBoard: 3 });
    expect(openView(container)).toBe('theirs');
  });

  it('leaves an ordinary inspection alone when no window is open', () => {
    const { container, rerenderWith } = renderPicker();
    fireEvent.click(tabs()[1]);
    rerenderWith({ demandOwnBoard: null });
    expect(openView(container)).toBe('theirs');
  });
});
