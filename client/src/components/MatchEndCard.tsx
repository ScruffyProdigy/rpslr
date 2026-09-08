import type { MatchEndReason, RoundResult } from '../api';
import type { Identity } from '../lib/seatProfile';
import type { GuessScore } from '../lib/usePlayAlong';
import { PLAYER_VOICE, winsMatch, youLabel, type Voice } from '../lib/voice';
import { LobbyReturnButton } from './LobbyReturnButton';
import { ShareReplayButton } from './ShareReplayButton';
import { PlayerAvatar } from './PlayerAvatar';
import { RoundStrip } from './RoundStrip';

/**
 * The end of a match, in place of the board. The scoreboard and picker come
 * off screen so this reads as an ending rather than a board with a banner on
 * it: who won, by how much, how it went, and the one way out.
 *
 * Losing is neutral, not red. Red means an error — a lost game of Rock Paper
 * Scissors is not one.
 */
export function MatchEndCard({
  iWon,
  drawn,
  you,
  opponent,
  myScore,
  oppScore,
  results,
  mySeatKey,
  myPlayerId,
  lobbyReturnUrl,
  endReason,
  voice = PLAYER_VOICE,
  activeRound = null,
  onSelectRound,
  replayUrl = null,
  playCtaUrl = null,
  called = null,
}: {
  iWon: boolean;
  /** No winner seat — the match ended without one (abandoned, or all draws). */
  drawn: boolean;
  you: Identity;
  opponent: Identity;
  myScore: number;
  oppScore: number;
  results: RoundResult[];
  mySeatKey: string;
  myPlayerId: string;
  lobbyReturnUrl: string | null;
  /** How the match ended. Anything but 'played' needs saying out loud. */
  endReason?: MatchEndReason | null;
  /** How to refer to the you-side: second person, or by name on a replay. */
  voice?: Voice;
  /** Round the strip should mark, when it is a replay's scrubber. */
  activeRound?: number | null;
  /** When set, the strip jumps the replay rather than expanding a chip. */
  onSelectRound?: (round: number) => void;
  /** Link to this match's replay — offered to the players who just played it. */
  replayUrl?: string | null;
  /** Link to JoinQuest — offered to whoever is watching the replay. */
  playCtaUrl?: string | null;
  /** How a play-along watcher's calls went, when they made any. */
  called?: GuessScore | null;
}) {
  const winner = drawn ? null : iWon ? you : opponent;
  const verdict = drawn
    ? 'The match ends level.'
    : iWon
      ? winsMatch(voice)
      : `${opponent.name} wins the match.`;

  // A match that ended on the clock rather than on the score has to say so —
  // otherwise the loser sees a defeat they never played, and the winner sees a
  // win they did not earn on the board.
  const howItEnded =
    endReason === 'abandoned'
      ? 'Neither player was still here.'
      : endReason === 'forfeit-disconnect'
        ? iWon
          ? `${opponent.name} disconnected and did not come back.`
          : `${youLabel(voice)} ${voice.you ? 'was' : 'were'} disconnected too long.`
        : endReason === 'forfeit-strikes'
          ? iWon
            ? `${opponent.name} ran out of time twice in a row.`
            : `${youLabel(voice)} ran out of time twice in a row.`
          : null;

  return (
    <div className="match-end">
      {winner && (
        <div className="match-end__winner">
          <PlayerAvatar
            profile={winner.profile}
            displayName={winner.name}
            placeholder={winner.placeholder}
            role={iWon ? 'you' : 'opp'}
            size="lg"
            winner
          />
          <span className="match-end__winner-name">{winner.name}</span>
        </div>
      )}

      <p className={`match-end__verdict ${drawn ? 'draw' : iWon ? 'win' : 'loss'}`}>{verdict}</p>

      {howItEnded && <p className="match-end__how">{howItEnded}</p>}

      <p className="match-end__score" aria-label={`Final score: ${voice.you ?? 'you'} ${myScore}, ${opponent.name} ${oppScore}`}>
        <span className="match-end__score-you" aria-hidden="true">
          {myScore}
        </span>
        <span className="match-end__score-sep" aria-hidden="true">
          –
        </span>
        <span className="match-end__score-opp" aria-hidden="true">
          {oppScore}
        </span>
      </p>

      {/* Alongside the match result rather than instead of it: the match had
          its own winner, and this is the watcher's score in a game of their
          own played on top of it. */}
      {called && called.called > 0 && (
        <p className="match-end__called">
          You called {called.hits} of {called.called} round
          {called.called === 1 ? '' : 's'}.
        </p>
      )}

      <div className="match-end__rounds">
        <RoundStrip
          results={results}
          mySeatKey={mySeatKey}
          myPlayerId={myPlayerId}
          you={you}
          opponent={opponent}
          voice={voice}
          activeRound={activeRound}
          onSelectRound={onSelectRound}
        />
      </div>

      {replayUrl && <ShareReplayButton url={replayUrl} />}

      {playCtaUrl && (
        <div className="match-end__cta">
          <p className="match-end__cta-line">
            {winner ? `Think you could beat ${winner.name}?` : 'Think you could do better?'}
          </p>
          <a className="lobby-return-btn" href={playCtaUrl}>
            Play RPSLR on JoinQuest
          </a>
        </div>
      )}

      {lobbyReturnUrl && <LobbyReturnButton href={lobbyReturnUrl} />}
    </div>
  );
}
