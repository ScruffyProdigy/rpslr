import { useEffect, useMemo, useState } from 'react';
import { Wordmark } from './App';
import { api, type MatchState } from './api';
import { MatchEndCard } from './components/MatchEndCard';
import { MovePicker } from './components/MovePicker';
import { PlayerAvatar } from './components/PlayerAvatar';
import { ReplayControls } from './components/ReplayControls';
import { RevealCard } from './components/RevealCard';
import { RoundStrip } from './components/RoundStrip';
import { useReplayPlayback } from './lib/useReplayPlayback';
import { spectatorVoice } from './lib/voice';
import { winningEdgeOf } from './moves';
import { buildReplay, replayBlockedReason } from './replay';

/**
 * Somebody else's finished match, watched from outside it.
 *
 * The board is the same board — same pentagon, same reveal, same history strip
 * — driven from a frame list instead of a socket. What changes is who it is
 * addressed to: nobody here is playing, so nothing is "yours", and both sides
 * are named. Seat order decides the colours, so a player is the same colour
 * every time the link is opened.
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
  const replay = useMemo(
    () => (state && !replayBlockedReason(state) ? buildReplay(state) : null),
    [state],
  );

  // One step past the last round, for the end card. Without it the deciding
  // round is never played — reaching the final frame *is* the end, so the
  // round that settled the match would only ever appear as a final score.
  // Hooks run before the early returns below, so this is 0 until the match
  // loads; the playback hook handles an empty replay without special-casing.
  const playback = useReplayPlayback(replay ? replay.frames.length + 1 : 0);

  if (error) return <ReplayMessage title="Replay unavailable" body={error} />;
  if (!state) return <ReplayMessage title="Loading the match…" body={null} />;
  if (blocked) return <ReplayMessage title={blocked} body={null} />;
  if (!replay) return <ReplayMessage title="This match has no rounds to replay" body={null} />;

  const over = playback.index >= replay.frames.length;
  // On the end-card step there is no round of its own, so the board keeps the
  // last one — the strip beneath it still reads as the whole match.
  const frameIndex = Math.min(playback.index, replay.frames.length - 1);
  const frame = replay.frames[frameIndex];
  const shown = replay.frames.slice(0, frameIndex + 1);
  const voice = spectatorVoice(replay.a.identity.name);
  const oppName = replay.b.identity.name;
  // While the verdict is withheld, so is everything that would give it away:
  // the arrow it was won on, and the scoreboard that has already counted it.
  const picksBeat = playback.beat === 'picks';
  const edge = picksBeat ? null : winningEdgeOf(frame.a.move, frame.b.move);
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
            {picksBeat ? frame.a.scoreBefore : frame.a.score}&ndash;
            {picksBeat ? frame.b.scoreBefore : frame.b.score}
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
      </header>

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
        />
      ) : (
        <MovePicker
          myDelays={frame.a.delaysBefore}
          oppDelays={frame.b.delaysBefore}
          myChosenMove={frame.a.move}
          lockedIn
          opponentLockedIn
          disabled
          round={frame.round}
          myRecentMoves={frame.a.recentMoves}
          onPlay={() => {}}
          voice={voice}
          oppName={oppName}
          winningEdge={edge}
          centerSlot={
            <RevealCard
              result={frame.result}
              phase={picksBeat ? 'picks' : 'card'}
                mySeatKey={replay.a.seatKey}
                myPlayerId={replay.a.playerId}
                you={replay.a.identity}
                opponent={replay.b.identity}
              voice={voice}
              onSkip={playback.next}
            />
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
