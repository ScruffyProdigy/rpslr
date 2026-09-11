import { useEffect, useMemo, useState } from 'react';
import { Wordmark } from './App';
import { api, type MatchState } from './api';
import { ruleCardSchedule } from './commentary';
import { HowToPlayDialog } from './components/HowToPlay';
import { MatchEndCard } from './components/MatchEndCard';
import { MovePicker } from './components/MovePicker';
import { PlayAlongToggle } from './components/PlayAlongToggle';
import { PlayerAvatar } from './components/PlayerAvatar';
import { ReplayCommentary } from './components/ReplayCommentary';
import { ReplayControls } from './components/ReplayControls';
import { RevealCard } from './components/RevealCard';
import { RoundStrip } from './components/RoundStrip';
import { useFirstMatchRules } from './lib/useFirstMatchRules';
import { scoreGuesses, usePlayAlong } from './lib/usePlayAlong';
import { useReplayPlayback } from './lib/useReplayPlayback';
import { getLobbyGameUrl } from './env';
import { withReplayAttribution } from './lib/replayLink';
import { spectatorVoice } from './lib/voice';
import { winningEdgeOf } from './moves';
import { buildReplay, flipReplay, replayBlockedReason } from './replay';

/**
 * Somebody else's finished match, watched from outside it.
 *
 * The board is the same board — same pentagon, same reveal, same history strip
 * — driven from a frame list instead of a socket. What changes is who it is
 * addressed to: nobody here is playing, so nothing is "yours", and both sides
 * are named. Seat order decides the colours, so a player is the same colour
 * every time the link is opened — unless the watcher steps into a seat to call
 * its moves, which is the one thing that earns a flip.
 */
export function ReplayPage({ matchRef }: { matchRef: string }) {
  const [state, setState] = useState<MatchState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .getState(matchRef)
      .then((s) => {
        if (live) setState(s);
      })
      .catch((err: Error) => {
        if (live) setError(err.message);
      });
    return () => {
      live = false;
    };
  }, [matchRef]);

  const blocked = state ? replayBlockedReason(state) : null;
  const match = useMemo(
    () => (state && !replayBlockedReason(state) ? buildReplay(state) : null),
    [state],
  );

  const playAlong = usePlayAlong();

  // Calling a player's moves means standing in their seat: their cooldowns are
  // the pills on the board, their side of the reveal card is the near one, and
  // the end card's verdict is about them. Everything downstream already reads
  // the you-side out of `a`, so the flip happens once, here.
  const replay = useMemo(
    () => (match && playAlong.side === 1 ? flipReplay(match) : match),
    [match, playAlong.side],
  );

  // One step past the last round, for the end card. Without it the deciding
  // round is never played — reaching the final frame *is* the end, so the
  // round that settled the match would only ever appear as a final score.
  // Hooks run before the early returns below, so this is 0 until the match
  // loads; the playback hook handles an empty replay without special-casing.
  // Nobody arriving on a shared replay link has been told the rules. The same
  // three panels a first match opens with, opened once here too and remembered
  // under the same key — someone who read them in a match should not be shown
  // them again by a link, and the panels answer the same question either way.
  const rules = useFirstMatchRules(replay !== null);

  // A round nobody has called yet holds the replay where it is, the same way
  // the rules panels do. Which round that is depends on the playback index the
  // hook itself owns, so it is asked for rather than told.
  const playback = useReplayPlayback(replay ? replay.frames.length + 1 : 0, (index) => {
    if (rules.open) return true;
    if (!playAlong.on || !replay) return false;
    const pending = replay.frames[index];
    return pending !== undefined && playAlong.guesses[pending.round] === undefined;
  });

  // Which round first puts each rule on the board. Computed once for the whole
  // replay so a rule is explained where it belongs rather than wherever the
  // watcher happens to have stepped to.
  const schedule = useMemo(() => (replay ? ruleCardSchedule(replay) : []), [replay]);

  const score = useMemo(
    () => scoreGuesses(replay?.frames ?? [], playAlong.guesses),
    [replay, playAlong.guesses],
  );

  if (error) return <ReplayMessage title="Replay unavailable" body={error} />;
  if (!state) return <ReplayMessage title="Loading the match…" body={null} />;
  if (blocked) return <ReplayMessage title={blocked} body={null} />;
  // `match` is what `replay` is built from, so one is null exactly when the
  // other is — narrowing both keeps the unflipped names reachable below.
  if (!match || !replay) {
    return <ReplayMessage title="This match has no rounds to replay" body={null} />;
  }

  const over = playback.index >= replay.frames.length;
  // On the end-card step there is no round of its own, so the board keeps the
  // last one — the strip beneath it still reads as the whole match.
  const frameIndex = Math.min(playback.index, replay.frames.length - 1);
  const frame = replay.frames[frameIndex];
  // What the watcher called for this round: a move, null if they let it go by,
  // undefined while it is still theirs to answer.
  const called = playAlong.guesses[frame.round];
  const awaiting = playAlong.on && !over && called === undefined;
  // A round waiting to be called is not one of the rounds so far: its chip
  // would sit under the board with the answer already on it.
  const shown = replay.frames.slice(0, frameIndex + (awaiting ? 0 : 1));
  const voice = spectatorVoice(replay.a.identity.name);
  // A replay's job is to turn a watcher into a player, so the way to JoinQuest
  // is on screen the whole time rather than only once the match runs out.
  //
  // Deliberately not `match.lobbyReturnUrl`: that is the way back to *this
  // match* for someone who played it, and a watcher has no seat to return to.
  // What they need is the game's own page, which is the same for every match
  // and exists even for a standalone one — where a return URL is null and the
  // button would simply never have appeared. The marker lets Lobby tell a
  // sign-up that came from a replay from one that didn't.
  const playCtaUrl = withReplayAttribution(getLobbyGameUrl());
  const oppName = replay.b.identity.name;
  // The card is mid-performance until it starts dissolving, and until then the
  // round's result is its to give: the arrow it was won on stays dark, and the
  // scoreboard still reads as it did going in. Both would otherwise announce
  // the verdict over the top of a card that has not reached it yet.
  // Nothing about a round waiting to be called is settled either: the
  // scoreline, the winning arrow and the commentary all read its outcome, and
  // any of them would answer the question before it was asked.
  const settled = !awaiting && playback.beat !== 'reveal';
  const edge = settled
    ? winningEdgeOf(frame.a.move, frame.b.move, { mine: frame.a.beats, theirs: frame.b.beats })
    : null;
  // A round with a missing pick is skipped by buildReplay, so a round number is
  // not an index — look it up rather than assume they line up.
  const jumpToRound = (round: number) => {
    const target = replay.frames.findIndex((f) => f.round === round);
    if (target >= 0) playback.jumpTo(target);
  };

  return (
    <div className="replay">
      <header className="replay__header">
        <Wordmark />
        <p className="replay__matchup">
          <PlayerAvatar
            profile={replay.a.identity.profile}
            displayName={replay.a.identity.name}
            placeholder={replay.a.identity.placeholder}
            role="you"
            size="sm"
          />
          <span className="replay__name">{replay.a.identity.name}</span>
          <span className="replay__score">
            {settled ? frame.a.score : frame.a.scoreBefore}&ndash;
            {settled ? frame.b.score : frame.b.scoreBefore}
          </span>
          <span className="replay__name">{oppName}</span>
          <PlayerAvatar
            profile={replay.b.identity.profile}
            displayName={oppName}
            placeholder={replay.b.identity.placeholder}
            role="opp"
            size="sm"
          />
        </p>
        <button
          type="button"
          className="rules-btn"
          aria-label="How to play"
          onClick={() => rules.setOpen(true)}
        >
          <span className="rules-btn__mark" aria-hidden="true">
            ?
          </span>
          <span className="rules-btn__label" aria-hidden="true">
            How to play
          </span>
        </button>
      </header>

      <HowToPlayDialog bestOf={replay.bestOf} open={rules.open} onClose={rules.dismiss} />

      <PlayAlongToggle
        on={playAlong.on}
        side={playAlong.side}
        names={[match.a.identity.name, match.b.identity.name]}
        onMode={playAlong.setOn}
        onSide={playAlong.setSide}
      />

      {over ? (
        <MatchEndCard
          iWon={replay.winnerSeatKey === replay.a.seatKey}
          drawn={replay.winnerSeatKey === null}
          you={replay.a.identity}
          opponent={replay.b.identity}
          myScore={replay.finalScore.a}
          oppScore={replay.finalScore.b}
          results={replay.frames.map((f) => f.result)}
          mySeatKey={replay.a.seatKey}
          myPlayerId={replay.a.playerId}
          lobbyReturnUrl={null}
          endReason={replay.endReason}
          voice={voice}
          activeRound={null}
          onSelectRound={jumpToRound}
          playCtaUrl={playCtaUrl}
          called={score}
        />
      ) : (
        <MovePicker
          myDelays={frame.a.delaysBefore}
          oppDelays={frame.b.delaysBefore}
          // The round is the watcher's to call until they have called it, so
          // the board is a live picker with nothing chosen on it rather than a
          // record of what was.
          myChosenMove={awaiting ? null : frame.a.move}
          lockedIn={!awaiting}
          opponentLockedIn
          disabled={!awaiting}
          round={frame.round}
          myRecentMoves={frame.a.recentMoves}
          myOpeningDelays={frame.a.openingDelays}
          myBeats={frame.a.beats}
          oppBeats={frame.b.beats}
          myLedger={frame.a.ledger}
          showOppCooldownCounts={replay.hasLoadouts}
          oppCanFreeze={frame.b.canFreeze}
          onPlay={(move) => {
            playAlong.call(frame.round, move);
            playback.resume();
          }}
          voice={voice}
          oppName={oppName}
          winningEdge={edge}
          centerSlot={
            // Nothing at all while the round is the watcher's: MovePicker reads
            // a centre slot as "a round is being shown" and falls back to its
            // own picker centre without one, which is the whole mode.
            awaiting ? undefined : playback.beat === 'strike' ? (
              // An empty element, not nothing: the same fallback would other-
              // wise speak to a player, and on a settled round there isn't one.
              <></>
            ) : (
              <RevealCard
                call={called}
                // Keyed by round so the card is a new one every time. The whole
                // showdown is CSS animation-delays hanging off a single mount,
                // and a card React reuses across rounds never mounts again —
                // round one would animate and nothing after it would.
                key={frame.round}
                result={frame.result}
                phase={playback.beat === 'outro' ? 'outro' : 'card'}
                mySeatKey={replay.a.seatKey}
                myPlayerId={replay.a.playerId}
                you={replay.a.identity}
                opponent={replay.b.identity}
                voice={voice}
                onSkip={playback.next}
              />
            )
          }
        />
      )}

      <ReplayControls
        playing={playback.playing}
        speed={playback.speed}
        stepping={playback.stepping}
        atStart={playback.index === 0}
        atEnd={playback.atEnd}
        onToggle={playback.toggle}
        onPrev={playback.prev}
        onNext={playback.next}
        onSpeed={playback.setSpeed}
      />

      {/*
        Under the transport rather than between it and the board. The commentary
        is the tallest thing on the page — a rule card and four notes is a real
        round, not a contrived one — and putting that much reading above the
        controls pushed play/pause off a phone screen. The board is watched, the
        transport is reached for, and the words are read: that is the order.
      */}
      {awaiting && (
        <p className="replay__call">
          {score.called > 0 && (
            <span className="replay__call-score">
              Called {score.hits} of {score.called}
            </span>
          )}
          <button
            type="button"
            className="replay__call-skip"
            onClick={() => {
              playAlong.skip(frame.round);
              playback.resume();
            }}
          >
            Skip this round
          </button>
        </p>
      )}

      {!over && !awaiting && (
        <ReplayCommentary
          frame={frame}
          replay={replay}
          card={schedule[frameIndex] ?? null}
          settled={settled}
        />
      )}

      {!over && (
        <div className="replay__rounds">
          <RoundStrip
            results={shown.map((f) => f.result)}
            mySeatKey={replay.a.seatKey}
            myPlayerId={replay.a.playerId}
          you={replay.a.identity}
            opponent={replay.b.identity}
            voice={voice}
            activeRound={frame.round}
            onSelectRound={jumpToRound}
          />
        </div>
      )}

      {playCtaUrl && !over && (
        <p className="replay__cta">
          <a className="lobby-return-btn" href={playCtaUrl}>
            Play RPSLR on JoinQuest
          </a>
        </p>
      )}
    </div>
  );
}

function ReplayMessage({ title, body }: { title: string; body: string | null }) {
  return (
    <div className="replay replay--message">
      <Wordmark />
      <h1 className="replay-message__title">{title}</h1>
      {body && <p className="replay-message__body">{body}</p>}
    </div>
  );
}
