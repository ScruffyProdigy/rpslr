import type { MatchEndReason, RoundResult } from '../api';
import type { Identity } from '../lib/seatProfile';
import { LobbyReturnButton } from './LobbyReturnButton';
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
}) {
  const winner = drawn ? null : iWon ? you : opponent;
  const verdict = drawn
    ? 'The match ends level.'
    : iWon
      ? 'You win the match!'
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
          : 'You were disconnected too long.'
        : endReason === 'forfeit-strikes'
          ? iWon
            ? `${opponent.name} ran out of time twice in a row.`
            : 'You ran out of time twice in a row.'
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

      <p className="match-end__score" aria-label={`Final score: you ${myScore}, ${opponent.name} ${oppScore}`}>
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

      <div className="match-end__rounds">
        <RoundStrip
          results={results}
          mySeatKey={mySeatKey}
          myPlayerId={myPlayerId}
          you={you}
          opponent={opponent}
        />
      </div>

      {lobbyReturnUrl && <LobbyReturnButton href={lobbyReturnUrl} />}
    </div>
  );
}
