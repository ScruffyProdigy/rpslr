import { useCallback, useEffect, useRef, useState } from 'react';
import type { DelayMap, MarkEvent } from '@game/game';
import type { Move } from '../api';
import {
  ARROW_INSET,
  BOARD,
  CIRCLE_EDGES,
  CIRCLE_ORDER,
  addedEdgePath,
  boardPct,
  circleNodePos,
} from '../lib/pentagon';
import { hasSeen, markSeen, type OneTimeNote } from '../lib/prefs';
import { PLAYER_VOICE, type Voice } from '../lib/voice';
import {
  MOVE_META,
  SHARED_BEATS,
  addedEdgesOf,
  backInPhrase,
  beatsOf,
  cooldownPhrase,
  cooldownReason,
  describeBoardGraph,
  describeBeatsOf,
  describeMatchup,
  liveMatchupEdges,
  isForcedPick,
  isPlayable,
  type BeatsMap,
  type WinningEdge,
} from '../moves';
import MoveIcon from './MoveIcon';
import UiIcon from './UiIcon';
import { PickerTabs, type PickerView } from './PickerTabs';
import type { Identity } from '../lib/seatProfile';

/** The board, for the tabs to point `aria-controls` at. */
const PANEL_ID = 'move-board-panel';

/**
 * Whose arrow a matchup edge is, so it takes that player's colour.
 *
 * Looked up rather than recomputed: `liveMatchupEdges` already resolved the pair
 * through both graphs, and asking a second time is how the colour and the edge
 * would come to disagree about an asymmetric one (JQ-324).
 */
function matchupRole(
  edges: Array<{ from: Move; to: Move; role: 'you' | 'opp' }>,
  from: Move,
  to: Move,
): 'you' | 'opp' {
  return edges.find((e) => e.from === from && e.to === to)?.role ?? 'you';
}

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
  myOpeningDelays,
  onPlay,
  secondsLeft = null,
  centerSlot,
  idleCaption,
  winningEdge = null,
  voice = PLAYER_VOICE,
  oppName,
  myBeats = SHARED_BEATS,
  oppBeats = SHARED_BEATS,
  myLedger = [],
  oppCanFreeze = false,
  you,
  opponent,
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
  /**
   * The marks your side opened the match on. Only the opening lock is read off
   * it: `cooldownCause` needs to know whether a move it cannot otherwise account
   * for started down, and a loadout decides that (JQ-207).
   */
  myOpeningDelays: DelayMap;
  onPlay: (move: Move) => void;
  /**
   * Seconds left in the round, or null when no clock is running. Used only to
   * commit a tapped move before the deadline — see `AUTO_COMMIT_AT_S`.
   */
  secondsLeft?: number | null;
  /** Takes over the centre slot — the round reveal, while it holds. */
  centerSlot?: React.ReactNode;
  /**
   * What the empty centre says instead of "Pick a move".
   *
   * For the one state where the default is a wrong instruction: during the
   * loadout reveal (JQ-149) the board is inert because round 1 has not started,
   * and telling a player to pick from five disabled moves reads as a bug. A
   * caption rather than a `centerSlot`, because the centre is still the idle
   * centre — only its words are wrong.
   */
  idleCaption?: string;
  /** The edge the round was just won on, lit as the reveal card dissolves. */
  winningEdge?: WinningEdge | null;
  /** How to refer to the you-side: second person, or by name on a replay. */
  voice?: Voice;
  /** The other player's name, for a replay's legend. */
  oppName?: string;
  /**
   * The two graphs. Each side's own, because a helper may hand one of them an edge
   * the other does not have, and both players have to be able to see both — a rule
   * you are playing against is no use to you unrendered (JQ-151).
   */
  myBeats?: BeatsMap;
  oppBeats?: BeatsMap;
  /** Your own mark events, so a cooldown can name what actually caused it. */
  myLedger?: readonly MarkEvent[];
  /** Whether the opponent can stop your marks coming off, so nothing promises turns. */
  oppCanFreeze?: boolean;
  /**
   * The two people the tabs name, for the avatar and the name on each.
   *
   * Optional, and defaulted from `voice` and `oppName` below, because the board
   * is rendered by tests and by surfaces that hold nothing richer than a name —
   * an avatar is worth having and is not worth making a caller invent (JQ-324).
   */
  you?: Identity;
  opponent?: Identity;
}) {
  // Two-tap pick: `picked` is the tapped move (first tap), `hovered` is the
  // desktop hover/focus preview. Only `picked` can be committed, so a tap that
  // also fires pointerenter can never lock a move by accident.
  const [picked, setPicked] = useState<Move | null>(null);
  const [hovered, setHovered] = useState<Move | null>(null);
  const autoCommitted = useRef(false);
  const preview = hovered ?? picked;

  // Whose board is drawn, and what has been tapped on theirs.
  //
  // `inspected` is deliberately not `picked`: nothing that reads a commit target
  // reads this, so an inspection cannot become a move by any path — not the
  // second tap, not the Lock in button, not the clock (JQ-324).
  const [view, setView] = useState<PickerView>('mine');
  const [inspected, setInspected] = useState<Move | null>(null);

  // Whether the next tap on `picked` commits it.
  //
  // The second tap is only a commit because the first one happened in front of
  // you. Leaving another board and coming back puts a board in front of you
  // again, so the sequence starts over — while `picked` itself survives, which
  // is the half the ticket is explicit about keeping.
  const commitArmed = useRef(false);

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

  // A new round is a new decision — and so is the board becoming pickable
  // again after it was not, which is how a replay watcher switching the player
  // they are calling for gets a clean board rather than the last one's tap.
  useEffect(() => {
    setPicked(null);
    setHovered(null);
    autoCommitted.current = false;
    commitArmed.current = false;
    // A new decision is your decision: the next ordinary selection phase opens
    // on your own board, whatever was being inspected when the round ended.
    setView('mine');
    setInspected(null);
  }, [round, disabled]);

  /**
   * Open the other board.
   *
   * Never a commit path, and never a clear: `picked` survives so the choice you
   * had carries across, and only the tap sequence and the transient hover reset.
   */
  const switchTo = useCallback((next: PickerView) => {
    setView(next);
    setInspected(null);
    setHovered(null);
    commitArmed.current = false;
  }, []);

  // The preview's caption and Lock-in button sit on top of the graph, so there
  // has to be a way to put them away and read what is underneath. Tapping the
  // board away from a move clears it; Escape does the same for a keyboard.
  const clearPreview = useCallback(() => {
    setPicked(null);
    setHovered(null);
  }, []);

  useEffect(() => {
    // On their board Escape is the way out of the inspection entirely — the
    // keyboard's version of the Back button in the centre.
    if (view === 'theirs') {
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') switchTo('mine');
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }
    if (!picked || lockedIn) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearPreview();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picked, lockedIn, clearPreview, view, switchTo]);

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
    // Not while their board is open. `picked` is still yours and still valid,
    // but the clock running out during an inspection must not play it for you
    // any more than a tap on their node could (JQ-324).
    if (view !== 'mine') return;
    // A tapped move you cannot play was a "why can't I play this?", not a
    // choice. Asked of the same helper the tap path uses, so the two cannot
    // disagree about what is playable — they used to hold separate copies of
    // the test, and the copies were both wrong under the floor (JQ-215).
    if (!isPlayable(picked, myDelays)) return;
    autoCommitted.current = true;
    commit(picked);
  }, [secondsLeft, boardState, picked, myDelays, commit, view]);

  function handleClick(move: Move) {
    // Their board answers questions and takes no decisions: a tap is a look at
    // one of their moves, and nothing here can reach `commit` (JQ-324).
    if (view === 'theirs') {
      setInspected((current) => (current === move ? null : move));
      return;
    }
    // A move you cannot play can be inspected but never committed: tapping it
    // asks "why can't I play this?", which previously got no answer at all.
    // A *marked* move may still be playable — see `isPlayable`.
    if (!isPlayable(move, myDelays)) {
      setPicked(move);
      commitArmed.current = false;
      return;
    }
    if (picked === move && commitArmed.current) commit(move);
    else {
      setPicked(move);
      commitArmed.current = true;
    }
  }

  // The tabs want a person each. A caller that has Lobby identities hands them
  // over; one that has only a name gets a name-shaped identity rather than
  // having to build one.
  const youIdentity: Identity = you ?? {
    profile: null,
    name: voice.you ?? 'You',
    placeholder: false,
  };
  const oppIdentity: Identity = opponent ?? {
    profile: null,
    name: oppName?.trim() || 'Opponent',
    placeholder: !oppName?.trim(),
  };

  /**
   * The board that is open, as one value.
   *
   * Every read below — the arrows, the pills, the labels, the text equivalent —
   * goes through this rather than reaching for `my*` or `opp*` directly. That is
   * the whole mechanism of the split: there is no way for the arrows to be
   * drawing one player while the nodes describe the other, because neither one
   * can see both any more (JQ-324).
   */
  const mineOpen = view === 'mine';
  const board = mineOpen
    ? { delays: myDelays, beats: myBeats, name: null as string | null }
    : { delays: oppDelays, beats: oppBeats, name: oppIdentity.name };

  const graphText = describeBoardGraph(board.delays, board.beats, board.name);
  // The viewed player's extra edges. Empty in a duel, which is what keeps the
  // ten-edge graph untouched there.
  const addedEdges = addedEdgesOf(board.beats);
  // Your pick against each move they can actually play, once their board is open
  // and you are carrying one. The comparison the ticket asks for, drawn as the
  // arrows that would decide it.
  const matchupEdges = !mineOpen && picked ? liveMatchupEdges(picked, oppDelays, myBeats, oppBeats) : [];
  const isMatchup = (from: Move, to: Move) =>
    matchupEdges.some((e) => e.from === from && e.to === to);

  const myMarked = CIRCLE_ORDER.filter((m) => (myDelays[m] ?? 0) > 0);
  const myLastMove = myRecentMoves[0] ?? null;
  const showTapHint = tapHint.show && !lockedIn && round <= 2;
  // One note at a time — two stacked bars push the board off a phone screen.
  const showCooldownNote =
    !showTapHint && cooldownNote.show && !lockedIn && myMarked.length > 0;


  return (
    <div className="move-picker">
      <PickerTabs
        view={view}
        onView={switchTo}
        you={youIdentity}
        opponent={oppIdentity}
        voice={voice}
        panelId={PANEL_ID}
      />
      <div
        className="move-board"
        data-state={boardState}
        id={PANEL_ID}
        role="tabpanel"
        aria-labelledby={`picker-tab-${view}`}
        data-view={view}
        onClick={(e) => {
          // A move button or the commit button owns its own click.
          if ((e.target as HTMLElement).closest?.('.move-btn, .picker-center__lock')) return;
          if (view === 'theirs') {
            setInspected(null);
            return;
          }
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
            // An attack the player whose board this is cannot make this round.
            // On your own board that is your own threat set — the four edges off
            // Lizard and Robot in a duel's first round — and on theirs it is the
            // read JQ-106 built, now in the view where it is the subject.
            const off = !won && !isPlayable(fromMove, board.delays);
            // Only your own board previews: on theirs the highlight belongs to
            // the matchup, which is a claim about two picks rather than one.
            const highlighted = mineOpen && preview === fromMove;
            const matchup = !won && isMatchup(fromMove, toMove);
            return (
              <line
                key={`${fromMove}-${toMove}`}
                data-from={fromMove}
                data-to={toMove}
                className={[
                  'beat-arrow',
                  off ? 'beat-arrow--off' : '',
                  highlighted ? 'beat-arrow--preview' : '',
                  matchup ? 'beat-arrow--matchup' : '',
                  matchup ? `beat-arrow--matchup-${matchupRole(matchupEdges, fromMove, toMove)}` : '',
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
                      : matchup
                        ? `url(#rps-arrow-${matchupRole(matchupEdges, fromMove, toMove)})`
                        : off
                          ? 'url(#rps-arrow-off)'
                          : 'url(#rps-arrow)'
                }
              />
            );
          })}
          {/* The edges a loadout added, drawn last so they sit over the ten.
              Curved, because an added edge is the reverse of one already there
              and a straight one would land on top of an arrow pointing the other
              way — see `addedEdgePath`. Role-coloured, so "whose rule is this?"
              is answered without reading the legend. */}
          {addedEdges.map(({ from, to }) => {
            // The curve belongs to whoever's board is open, so its colour is the
            // view's rather than a tag carried on the edge.
            const role = mineOpen ? ('you' as const) : ('opp' as const);
            const won =
              winningEdge?.added && winningEdge.from === from && winningEdge.to === to;
            // An extra edge off a move its owner cannot play this round is as
            // dead as any other attack they cannot make.
            const off = !won && !isPlayable(from, board.delays);
            const highlighted = mineOpen && preview === from;
            const matchup = !won && isMatchup(from, to);
            return (
              <path
                key={`added-${role}-${from}-${to}`}
                data-added-from={from}
                data-added-to={to}
                data-role={role}
                className={[
                  'beat-arrow',
                  'beat-arrow--added',
                  `beat-arrow--added-${role}`,
                  off ? 'beat-arrow--off' : '',
                  highlighted ? 'beat-arrow--preview' : '',
                  matchup ? 'beat-arrow--matchup' : '',
                  matchup ? `beat-arrow--matchup-${matchupRole(matchupEdges, from, to)}` : '',
                  won ? 'beat-arrow--won' : '',
                  won ? `beat-arrow--won-${winningEdge.role}` : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                fill="none"
                d={addedEdgePath(CIRCLE_ORDER.indexOf(from), CIRCLE_ORDER.indexOf(to))}
                markerEnd={
                  off ? 'url(#rps-arrow-off)' : `url(#rps-arrow-${role})`
                }
              />
            );
          })}
        </svg>

        {CIRCLE_ORDER.map((m, i) => {
          const pos = circleNodePos(i);
          const delay = board.delays[m] ?? 0;
          // Two flags, not one. `onCooldown` used to mean both "carries marks"
          // and "cannot be played", which is the bug: under the floor a marked
          // move may be the only thing you can play. `blocked || forced` is
          // exactly the old test (JQ-215).
          const blocked = !isPlayable(m, board.delays);
          const forced = isForcedPick(m, board.delays);
          // Your pick, your check mark, your preview: none of the three mean
          // anything on a board that is not yours to act on.
          const selected = mineOpen && myChosenMove === m;
          const previewed = mineOpen && preview === m;
          const inspecting = !mineOpen && inspected === m;
          // The viewed player's graph, not the shared one: previewing Lizard as
          // a Chimera owner has to light Scissors too, or the caption and the
          // board disagree.
          const lit = mineOpen ? preview : inspected;
          const isTarget = lit != null && lit !== m && beatsOf(lit, board.beats).includes(m);
          // Whose cooldown this is has to be in the words, not only in the
          // colour of the pill — and only one player's is ever read, so a node
          // no longer recites two cooldown sets (JQ-324).
          const label = [
            MOVE_META[m].label,
            forced && mineOpen ? 'marked but playable, costs you more' : '',
            forced && !mineOpen ? 'marked but playable for them' : '',
            blocked && mineOpen ? cooldownPhrase(delay) : '',
            blocked && !mineOpen ? `${board.name} can't play it, ${cooldownPhrase(delay)}` : '',
            blocked && mineOpen
              ? cooldownReason(m, myRecentMoves, myOpeningDelays, myLedger).toLowerCase()
              : '',
          ]
            .filter(Boolean)
            .join(', ');
          return (
            <button
              key={m}
              className={[
                'move-btn',
                blocked ? 'move-btn--cooldown' : '',
                forced ? 'move-btn--forced' : '',
                selected ? 'move-btn--selected' : '',
                previewed && !selected ? 'move-btn--preview' : '',
                inspecting ? 'move-btn--inspected' : '',
                isTarget ? 'move-btn--target' : '',
                lockedIn && mineOpen && !selected ? 'move-btn--dimmed' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ left: boardPct(pos.x), top: boardPct(pos.y) }}
              disabled={disabled}
              aria-disabled={blocked || undefined}
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
              // A tap on their board takes no decision, so nothing on it is
              // pressed — `aria-pressed` there would announce a commitment that
              // does not exist.
              aria-pressed={mineOpen ? selected : undefined}
            >
              {selected && (
                <UiIcon name="check" className="move-btn__check" />
              )}
              <MoveIcon move={m} className="move-btn__emoji" />
              <span className="move-btn__name">{MOVE_META[m].label}</span>
              {/* One pill, belonging to whoever's board is open, and it always
                  carries the count.
                  Their marks used to be a separate badge with the number held
                  back in a duel, because the badge shared a node with your own
                  state and a number there restated the history strip. Their board
                  is their own now, so it reads exactly like yours (JQ-151,
                  JQ-324). */}
              {delay > 0 &&
                (forced ? (
                  // The button's own label says "marked but playable". A second
                  // voice saying "on cooldown" would contradict it, so here the
                  // pill is decoration.
                  <span
                    className={`cooldown-pill${mineOpen ? '' : ' cooldown-pill--theirs'}`}
                    aria-hidden="true"
                  >
                    <UiIcon name="hourglass" /> {delay}
                  </span>
                ) : (
                  <span
                    className={`cooldown-pill${mineOpen ? '' : ' cooldown-pill--theirs'}`}
                    role="img"
                    aria-label={cooldownPhrase(delay)}
                  >
                    <UiIcon name="hourglass" /> {delay}
                  </span>
                ))}
            </button>
          );
        })}

        {/* One live region, mounted for the life of the board.
            The centre is the board's voice — the prompt, the preview caption,
            the wait, the round result — and it used to be two regions taking
            turns: `PickerCenter` carried one, `RevealCard` brought another,
            and the reveal swapped one for the other mid-round. A region that
            appears with its content already in it is not reliably announced,
            which put the round result, the one thing that must never be
            dropped, on the unreliable path. Now the region outlives the swap
            and only its contents change. It is `inset: 0` so the absolutely
            positioned card inside still centres on the board. */}
        <div className="picker-slot" role="status">
          {centerSlot ??
            (view === 'theirs' ? (
              <OpponentCenter
                name={oppIdentity.name}
                inspected={inspected}
                picked={picked}
                oppDelays={oppDelays}
                oppBeats={oppBeats}
                myBeats={myBeats}
                voice={voice}
                onBack={() => switchTo('mine')}
              />
            ) : (
            <PickerCenter
              idleCaption={idleCaption}
              preview={preview}
              picked={picked}
              lockedIn={lockedIn}
              opponentLockedIn={opponentLockedIn}
              myChosenMove={myChosenMove}
              myDelays={myDelays}
              myRecentMoves={myRecentMoves}
              myOpeningDelays={myOpeningDelays}
              onCommit={commit}
              voice={voice}
              myBeats={myBeats}
              myLedger={myLedger}
              oppCanFreeze={oppCanFreeze}
            />
            ))}
        </div>
      </div>

      {/* The pentagon in words.
          The arrows above are an aria-hidden SVG, so this is the whole graph
          for anyone who cannot see it. Deliberately not a live region: it is
          reference material to be read while deciding, and announcing it every
          time a cooldown ticks would talk over the round. */}
      <section className="sr-only" aria-label="What beats what">
        <ul>
          {graphText.edges.map((line) => (
            <li key={line}>{line}</li>
          ))}
          {/* Said as extras, after the ten. The board draws them as curves; this
              is the same claim for anyone who cannot see one. */}
          {graphText.added.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p>{graphText.availability}</p>
      </section>

      {/* One player's legend, because one player's board is open.
          This is also what pays for the tab strip above the board: the two-line
          legend that named both sides and explained the fade is one line now,
          and the page had 0.9px of slack to give (JQ-324, see
          `--board-furniture`). */}
      <p className="graph-legend">
        <span
          className={`cooldown-pill cooldown-pill--legend${
            mineOpen ? '' : ' cooldown-pill--theirs'
          }`}
          aria-hidden="true"
        >
          <UiIcon name="hourglass" /> N
        </span>{' '}
        {/* No possessive, and that is the split paying for itself: the tab
            above says whose board this is, the pill takes their colour, and the
            text equivalent below names them outright. A legend that repeated it
            ran to two lines at every width the board supports, and the second
            line is the tab strip's height (JQ-324). */}
        cooldown · faded = can&rsquo;t attack
        {/* One entry, and only in a match that has one to explain. Phase 2 cut the
            legend to two items and it is not growing back: a duel renders exactly
            the one above (JQ-151). */}
        {addedEdges.length > 0 && (
          <>
            {' · '}
            <span className="graph-legend__added" aria-hidden="true" />{' '}
            curved = extra rule
          </>
        )}
      </p>

      {/* Wherever the board can be tapped — a live match, or a replay being
          called along with. Not on a replay being watched, where the hint
          would point at a board that does not answer. */}
      {showTapHint && !disabled && (
        <OneTimeNoteBar onDismiss={tapHint.dismiss}>
          Tap to preview · tap again to lock in.
        </OneTimeNoteBar>
      )}

      {showCooldownNote && !voice.you && (
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
 *
 * It carries no `role="status"` of its own — the slot it renders into is the
 * board's one live region, and a second one nested inside would double-announce
 * (JQ-157).
 */
function PickerCenter({
  idleCaption,
  preview,
  picked,
  lockedIn,
  opponentLockedIn,
  myChosenMove,
  myDelays,
  myRecentMoves,
  myOpeningDelays,
  onCommit,
  voice,
  myBeats,
  myLedger,
  oppCanFreeze,
}: {
  idleCaption?: string;
  preview: Move | null;
  picked: Move | null;
  lockedIn: boolean;
  opponentLockedIn: boolean;
  myChosenMove: Move | null;
  myDelays: Record<string, number>;
  myRecentMoves: Move[];
  myOpeningDelays: DelayMap;
  onCommit: (move: Move) => void;
  /** How to refer to the you-side: second person, or by name on a replay. */
  voice: Voice;
  /** Your graph — every caption here is about a move of yours. */
  myBeats: BeatsMap;
  myLedger: readonly MarkEvent[];
  oppCanFreeze: boolean;
}) {
  // After lock-in the centre holds your pick — and the wait — so the page
  // below the board doesn't have to say anything.
  if (lockedIn && myChosenMove) {
    return (
      <div className="picker-center picker-center--waiting">
        <span className="picker-center__pick">
          <MoveIcon move={myChosenMove} className="picker-center__pick-icon" />{' '}
          {MOVE_META[myChosenMove].label}
        </span>
        <p className="picker-center__caption">{describeBeatsOf(myChosenMove, myBeats)}</p>
        <p className="picker-center__waiting">
          {opponentLockedIn ? 'Revealing round…' : 'Waiting for opponent…'}
        </p>
      </div>
    );
  }

  const shown = lockedIn ? myChosenMove : preview;
  if (!shown) {
    return (
      <div className="picker-center picker-center--idle">
        <span className="picker-center__idle">
          {idleCaption ?? (voice.you ? `What does ${voice.you} play?` : 'Pick a move')}
        </span>
      </div>
    );
  }

  const myDelay = myDelays[shown] ?? 0;

  // Marked, and the only thing on offer. It is *not* the blocked panel below:
  // it has to say the move can be played and what playing it costs, and it
  // still offers Lock in. Reachable only when no move is on zero (JQ-215).
  if (isForcedPick(shown, myDelays)) {
    const commitForced = !lockedIn && picked != null && preview === picked ? picked : null;
    return (
      <div className="picker-center picker-center--forced">
        <p className="picker-center__caption">{describeBeatsOf(shown, myBeats)}</p>
        <p className="picker-center__forced">
          Every move is marked — {MOVE_META[shown].label} is your cheapest. Playing it puts it
          further down.
        </p>
        {commitForced && (
          <button className="picker-center__lock" onClick={() => onCommit(commitForced)}>
            Lock in {MOVE_META[commitForced].label}
          </button>
        )}
      </div>
    );
  }

  // An unavailable move explains itself: why it is down, and when it is back.
  if (!isPlayable(shown, myDelays)) {
    return (
      <div className="picker-center picker-center--why">
        <p className="picker-center__caption">{describeBeatsOf(shown, myBeats)}</p>
        <p className="picker-center__why">
          {cooldownReason(shown, myRecentMoves, myOpeningDelays, myLedger)} —{' '}
          {backInPhrase(myDelay, oppCanFreeze)}
        </p>
      </div>
    );
  }

  // Only a tapped move can be committed, so hovering a different node teaches
  // without moving the commit target out from under the pointer.
  const commitTarget = !lockedIn && picked != null && preview === picked ? picked : null;

  return (
    <div className="picker-center">
      <p className="picker-center__caption">{describeBeatsOf(shown, myBeats)}</p>
      {/* Nothing here about what the opponent can play. That claim used to sit
          under your own caption; it lives on their board now, where it is the
          subject rather than a second thing to read while deciding (JQ-324). */}
      {commitTarget && (
        <button className="picker-center__lock" onClick={() => onCommit(commitTarget)}>
          Lock in {MOVE_META[commitTarget].label}
        </button>
      )}
    </div>
  );
}

/**
 * The centre while their board is open.
 *
 * Reads their graph for everything it says about their move, and both graphs for
 * the matchup — a Chimera owner's Lizard beats a Scissors that beats everyone
 * else's, and a sentence that assumed one graph would be confidently wrong about
 * exactly the pair a player most needs to ask about.
 *
 * It renders into the board's one live region, like `PickerCenter`, and carries
 * no `role="status"` of its own (JQ-157). It offers no commit control of any
 * kind: the only button here is the way back (JQ-324).
 */
function OpponentCenter({
  name,
  inspected,
  picked,
  oppDelays,
  oppBeats,
  myBeats,
  voice,
  onBack,
}: {
  name: string;
  /** The move of theirs being asked about, if any. */
  inspected: Move | null;
  /** Your tentative pick, which turns the panel into a comparison. */
  picked: Move | null;
  oppDelays: Record<string, number>;
  oppBeats: BeatsMap;
  myBeats: BeatsMap;
  voice: Voice;
  onBack: () => void;
}) {
  const back = (
    <button className="picker-center__back" onClick={onBack}>
      {/* The arrow is decoration; the words are the name a screen reader
          reads, so it stays out of them. */}
      <span aria-hidden="true">←</span> Back to {voice.you ? `${voice.you}'s` : 'your'} moves
    </button>
  );

  if (!inspected) {
    return (
      <div className="picker-center picker-center--theirs picker-center--idle">
        <span className="picker-center__idle">Tap one of {name}&rsquo;s moves</span>
        {back}
      </div>
    );
  }

  const delay = oppDelays[inspected] ?? 0;
  // Their availability is a legality question, not a mark count: the floor
  // leaves a fully-marked player their least-marked moves, and saying they
  // cannot play one of those would be a false all-clear (JQ-215).
  const down = !isPlayable(inspected, oppDelays);
  const matchup = picked ? describeMatchup(picked, inspected, { mine: myBeats, theirs: oppBeats }) : null;

  return (
    <div className="picker-center picker-center--theirs">
      <p className="picker-center__caption">{describeBeatsOf(inspected, oppBeats)}</p>
      {down && (
        <p className="picker-center__why">
          {name} can&rsquo;t play it — {backInPhrase(delay)}
        </p>
      )}
      {matchup && (
        <p className="picker-center__matchup">
          {matchup.line}
          {matchup.winner === 'you' && ` — ${voice.you ? `${voice.you} wins` : 'you win'}`}
          {matchup.winner === 'opp' && ` — ${name} wins`}
        </p>
      )}
      {back}
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
