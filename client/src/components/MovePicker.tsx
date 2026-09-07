import { useCallback, useEffect, useRef, useState } from 'react';
import type { Move } from '../api';
import {
  ARROW_INSET,
  BOARD,
  CIRCLE_EDGES,
  CIRCLE_ORDER,
  boardPct,
  circleNodePos,
} from '../lib/pentagon';
import { hasSeen, markSeen, type OneTimeNote } from '../lib/prefs';
import {
  MOVE_META,
  beatsOf,
  cooldownCause,
  cooldownPhrase,
  describeBeatsOf,
  opponentCooldownPhrase,
  type WinningEdge,
} from '../moves';
import MoveIcon from './MoveIcon';
import UiIcon from './UiIcon';

/** Remembers a one-time note's dismissal across reloads. */
function useOneTimeNote(note: OneTimeNote): { show: boolean; dismiss: () => void } {
  const [seen, setSeen] = useState(() => hasSeen(note));
  const dismiss = useCallback(() => {
    markSeen(note);
    setSeen(true);
  }, [note]);
  return { show: !seen, dismiss };
}

/**
 * Seconds before the deadline at which a tapped-but-unlocked move is committed
 * for you. Far enough out to beat a slow round-trip; close enough that you keep
 * the decision for nearly the whole round and can still switch or clear.
 */
const AUTO_COMMIT_AT_S = 2;

export function MovePicker({
  myDelays,
  oppDelays,
  myChosenMove,
  lockedIn,
  opponentLockedIn = false,
  disabled,
  round,
  myRecentMoves,
  onPlay,
  secondsLeft = null,
  centerSlot,
  winningEdge = null,
}: {
  myDelays: Record<string, number>;
  oppDelays: Record<string, number>;
  myChosenMove: Move | null;
  lockedIn: boolean;
  opponentLockedIn?: boolean;
  disabled: boolean;
  round: number;
  /** Your last two picks, most recent first — explains your cooldowns. */
  myRecentMoves: Move[];
  onPlay: (move: Move) => void;
  /**
   * Seconds left in the round, or null when no clock is running. Used only to
   * commit a tapped move before the deadline — see `AUTO_COMMIT_AT_S`.
   */
  secondsLeft?: number | null;
  /** Takes over the centre slot — the round reveal, while it holds. */
  centerSlot?: React.ReactNode;
  /** The edge the round was just won on, lit as the reveal card dissolves. */
  winningEdge?: WinningEdge | null;
}) {
  // Two-tap pick: `picked` is the tapped move (first tap), `hovered` is the
  // desktop hover/focus preview. Only `picked` can be committed, so a tap that
  // also fires pointerenter can never lock a move by accident.
  const [picked, setPicked] = useState<Move | null>(null);
  const [hovered, setHovered] = useState<Move | null>(null);
  const autoCommitted = useRef(false);
  const preview = hovered ?? picked;

  const tapHint = useOneTimeNote('tapHint');
  const cooldownNote = useOneTimeNote('cooldownExplainer');


  /* What the board is doing, for the glow behind the pentagon. The board is
     the hero surface, so it lights up in your colour while the round is
     actually waiting on you, and steps back to neutral once it isn't. */
  const boardState = centerSlot
    ? 'reveal'
    : lockedIn
      ? 'waiting'
      : disabled
        ? 'idle'
        : 'picking';

  // A new round is a new decision.
  useEffect(() => {
    setPicked(null);
    setHovered(null);
    autoCommitted.current = false;
  }, [round]);

  // The preview's caption and Lock-in button sit on top of the graph, so there
  // has to be a way to put them away and read what is underneath. Tapping the
  // board away from a move clears it; Escape does the same for a keyboard.
  const clearPreview = useCallback(() => {
    setPicked(null);
    setHovered(null);
  }, []);

  useEffect(() => {
    if (!picked || lockedIn) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearPreview();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picked, lockedIn, clearPreview]);

  const commit = useCallback(
    (move: Move) => {
      // Locking in for the first time is proof the hint landed.
      tapHint.dismiss();
      onPlay(move);
    },
    [onPlay, tapHint],
  );

  // Last chance to speak before the server picks for you.
  //
  // When the round expires the server plays a random live move. If you had
  // deliberately tapped one and simply ran out of time, having something else
  // played instead reads as the game taking the decision away from you — so we
  // commit the tapped move just before the deadline, through the ordinary play
  // path. The server stays authoritative: it still owns when the round ends and
  // still auto-picks when nothing arrives. This only gets a word in first.
  //
  // If it loses the race (backgrounded tab, slow network) the server has
  // already recorded its pick, and `recordMove` rejects the duplicate — first
  // write wins in both repositories, so there is no overwrite path and no
  // protocol change needed. App swallows that specific conflict.
  //
  // `picked` and never `preview`: `preview` falls back to `hovered`, which is
  // desktop mouse-over and keyboard focus. Auto-committing a hover would be
  // worse than random — a mouse resting anywhere on the board would silently
  // decide the round. A tap is evidence of intent; a cursor is not.
  // Once per round: the clock keeps ticking past the threshold, and `lockedIn`
  // only becomes true after the server round-trips, so without this the effect
  // fires again on every tick in between.
  useEffect(() => {
    if (secondsLeft === null || secondsLeft > AUTO_COMMIT_AT_S) return;
    // 'picking' is precisely "the board is yours to act on" — not revealing,
    // not already locked in, not disabled. Reusing it keeps the auto-commit
    // from carrying a second, drifting notion of the same thing.
    if (boardState !== 'picking' || !picked || autoCommitted.current) return;
    // A tapped move on cooldown was a "why can't I play this?", not a choice.
    if ((myDelays[picked] ?? 0) > 0) return;
    autoCommitted.current = true;
    commit(picked);
  }, [secondsLeft, boardState, picked, myDelays, commit]);

  function handleClick(move: Move) {
    // A move on cooldown can be inspected but never committed: tapping it asks
    // "why can't I play this?", which previously got no answer at all.
    if ((myDelays[move] ?? 0) > 0) {
      setPicked(move);
      return;
    }
    if (picked === move) commit(move);
    else setPicked(move);
  }

  const myCooldowns = CIRCLE_ORDER.filter((m) => (myDelays[m] ?? 0) > 0);
  const myLastMove = myRecentMoves[0] ?? null;
  const showTapHint = tapHint.show && !lockedIn && round <= 2;
  // One note at a time — two stacked bars push the board off a phone screen.
  const showCooldownNote =
    !showTapHint && cooldownNote.show && !lockedIn && myCooldowns.length > 0;


  return (
    <div className="move-picker">
      <div
        className="move-board"
        data-state={boardState}
        onClick={(e) => {
          // A move button or the commit button owns its own click.
          if ((e.target as HTMLElement).closest?.('.move-btn, .picker-center__lock')) return;
          if (lockedIn) return;
          clearPreview();
        }}
      >
        <svg
          className={`move-arrows${winningEdge ? ' move-arrows--strike' : ''}`}
          viewBox={`0 0 ${BOARD} ${BOARD}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          <defs>
            <marker
              id="rps-arrow"
              className="arrowhead"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" />
            </marker>
            <marker
              id="rps-arrow-you"
              className="arrowhead arrowhead--you"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" />
            </marker>
            <marker
              id="rps-arrow-opp"
              className="arrowhead arrowhead--opp"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" />
            </marker>
            <marker
              id="rps-arrow-off"
              className="arrowhead arrowhead--off"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" />
            </marker>
          </defs>
          {CIRCLE_EDGES.map(({ from, to }) => {
            const fromMove = CIRCLE_ORDER[from];
            const toMove = CIRCLE_ORDER[to];
            const a = circleNodePos(from);
            const b = circleNodePos(to);
            const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            const ux = (b.x - a.x) / len;
            const uy = (b.y - a.y) / len;
            // The arrow the round was just won on. It outranks the faded
            // state — a win off a move the opponent had on cooldown last round
            // still reads as a win.
            const won = winningEdge?.from === fromMove && winningEdge.to === toMove;
            // An attack the opponent can't make this round: draw it as a faded
            // threat so a node with no solid incoming arrow reads as safe.
            const oppOff = !won && (oppDelays[fromMove] ?? 0) > 0;
            const highlighted = preview === fromMove;
            return (
              <line
                key={`${fromMove}-${toMove}`}
                data-from={fromMove}
                data-to={toMove}
                className={[
                  'beat-arrow',
                  oppOff ? 'beat-arrow--opp-off' : '',
                  highlighted ? 'beat-arrow--preview' : '',
                  won ? 'beat-arrow--won' : '',
                  won ? `beat-arrow--won-${winningEdge.role}` : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                x1={a.x + ux * ARROW_INSET}
                y1={a.y + uy * ARROW_INSET}
                x2={b.x - ux * ARROW_INSET}
                y2={b.y - uy * ARROW_INSET}
                markerEnd={
                  won
                    ? `url(#rps-arrow-${winningEdge.role})`
                    : highlighted
                      ? 'url(#rps-arrow-you)'
                      : oppOff
                        ? 'url(#rps-arrow-off)'
                        : 'url(#rps-arrow)'
                }
              />
            );
          })}
        </svg>

        {CIRCLE_ORDER.map((m, i) => {
          const pos = circleNodePos(i);
          const myDelay = myDelays[m] ?? 0;
          const oppDelay = oppDelays[m] ?? 0;
          const onCooldown = myDelay > 0;
          const selected = myChosenMove === m;
          const previewed = preview === m;
          const isTarget = preview != null && preview !== m && beatsOf(preview).includes(m);
          const label = [
            MOVE_META[m].label,
            onCooldown ? cooldownPhrase(myDelay) : '',
            onCooldown ? cooldownCause(m, myRecentMoves).toLowerCase() : '',
            oppDelay > 0 ? `opponent cooldown, ${oppDelay} turn${oppDelay === 1 ? '' : 's'}` : '',
          ]
            .filter(Boolean)
            .join(', ');
          return (
            <button
              key={m}
              className={[
                'move-btn',
                onCooldown ? 'move-btn--cooldown' : '',
                selected ? 'move-btn--selected' : '',
                previewed && !selected ? 'move-btn--preview' : '',
                isTarget ? 'move-btn--target' : '',
                lockedIn && !selected ? 'move-btn--dimmed' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ left: boardPct(pos.x), top: boardPct(pos.y) }}
              disabled={disabled}
              aria-disabled={onCooldown || undefined}
              onClick={() => handleClick(m)}
              onPointerEnter={(e) => {
                if (e.pointerType === 'mouse') setHovered(m);
              }}
              onPointerLeave={(e) => {
                if (e.pointerType === 'mouse') setHovered(null);
              }}
              onFocus={() => setHovered(m)}
              onBlur={() => setHovered(null)}
              aria-label={label}
              aria-pressed={selected}
            >
              {selected && (
                <UiIcon name="check" className="move-btn__check" />
              )}
              <MoveIcon move={m} className="move-btn__emoji" />
              <span className="move-btn__name">{MOVE_META[m].label}</span>
              {onCooldown && (
                <span className="cooldown-pill" role="img" aria-label={cooldownPhrase(myDelay)}>
                  <UiIcon name="hourglass" /> {myDelay}
                </span>
              )}
              {oppDelay > 0 && (
                <span className="opp-cooldown-mark" aria-hidden="true">
                  <UiIcon name="hourglass" />
                </span>
              )}
            </button>
          );
        })}

        {centerSlot ?? (
          <PickerCenter
            preview={preview}
            picked={picked}
            lockedIn={lockedIn}
            opponentLockedIn={opponentLockedIn}
            myChosenMove={myChosenMove}
            myDelays={myDelays}
            myRecentMoves={myRecentMoves}
            oppDelays={oppDelays}
            onCommit={commit}
          />
        )}
      </div>

      <p className="graph-legend">
        <span className="cooldown-pill cooldown-pill--legend" aria-hidden="true">
          <UiIcon name="hourglass" /> N
        </span>{' '}
        your cooldown ·{' '}
        <span className="opp-cooldown-mark opp-cooldown-mark--legend" aria-hidden="true">
          <UiIcon name="hourglass" />
        </span>{' '}
        opponent cooldown (faded arrows = attacks they can&rsquo;t make)
      </p>

      {showTapHint && (
        <OneTimeNoteBar onDismiss={tapHint.dismiss}>
          Tap to preview · tap again to lock in.
        </OneTimeNoteBar>
      )}

      {showCooldownNote && (
        <OneTimeNoteBar onDismiss={cooldownNote.dismiss}>
          {myLastMove && (myDelays[myLastMove] ?? 0) > 0
            ? `You played ${MOVE_META[myLastMove].label} last round — it's back in ${
                myDelays[myLastMove]
              } turn${myDelays[myLastMove] === 1 ? '' : 's'}.`
            : "Lizard & Robot start on cooldown, and every move you play goes on cooldown for 2 turns."}
        </OneTimeNoteBar>
      )}
    </div>
  );
}

/**
 * The pentagon's middle cell: idle prompt, preview caption, the explicit
 * "Lock in" commit, and your pinned pick once the round is locked.
 */
function PickerCenter({
  preview,
  picked,
  lockedIn,
  opponentLockedIn,
  myChosenMove,
  myDelays,
  myRecentMoves,
  oppDelays,
  onCommit,
}: {
  preview: Move | null;
  picked: Move | null;
  lockedIn: boolean;
  opponentLockedIn: boolean;
  myChosenMove: Move | null;
  myDelays: Record<string, number>;
  myRecentMoves: Move[];
  oppDelays: Record<string, number>;
  onCommit: (move: Move) => void;
}) {
  // After lock-in the centre holds your pick — and the wait — so the page
  // below the board doesn't have to say anything.
  if (lockedIn && myChosenMove) {
    return (
      <div className="picker-center picker-center--waiting" role="status">
        <span className="picker-center__pick">
          <MoveIcon move={myChosenMove} className="picker-center__pick-icon" />{' '}
          {MOVE_META[myChosenMove].label}
        </span>
        <p className="picker-center__caption">{describeBeatsOf(myChosenMove)}</p>
        <p className="picker-center__waiting">
          {opponentLockedIn ? 'Revealing round…' : 'Waiting for opponent…'}
        </p>
      </div>
    );
  }

  const shown = lockedIn ? myChosenMove : preview;
  if (!shown) {
    return (
      <div className="picker-center picker-center--idle" role="status">
        <span className="picker-center__idle">Pick a move</span>
      </div>
    );
  }

  // An unavailable move explains itself: why it is down, and when it is back.
  const myDelay = myDelays[shown] ?? 0;
  if (myDelay > 0) {
    return (
      <div className="picker-center picker-center--why" role="status">
        <p className="picker-center__caption">{describeBeatsOf(shown)}</p>
        <p className="picker-center__why">
          {cooldownCause(shown, myRecentMoves)} — back in {myDelay} turn
          {myDelay === 1 ? '' : 's'}
        </p>
      </div>
    );
  }

  const oppDelay = oppDelays[shown] ?? 0;
  // Only a tapped move can be committed, so hovering a different node teaches
  // without moving the commit target out from under the pointer.
  const commitTarget = !lockedIn && picked != null && preview === picked ? picked : null;

  return (
    <div className="picker-center" role="status">
      <p className="picker-center__caption">{describeBeatsOf(shown)}</p>
      {oppDelay > 0 && (
        <p className="picker-center__opp">{opponentCooldownPhrase(shown, oppDelay)}</p>
      )}
      {commitTarget && (
        <button className="picker-center__lock" onClick={() => onCommit(commitTarget)}>
          Lock in {MOVE_META[commitTarget].label}
        </button>
      )}
    </div>
  );
}

function OneTimeNoteBar({
  children,
  onDismiss,
}: {
  children: React.ReactNode;
  onDismiss: () => void;
}) {
  return (
    <p className="picker-note">
      <span>{children}</span>
      <button className="picker-note__dismiss" onClick={onDismiss} aria-label="Dismiss">
        <UiIcon name="close" />
      </button>
    </p>
  );
}
