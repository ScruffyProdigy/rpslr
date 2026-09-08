import type { Move, RoundResult } from '../api';
import type { RevealPhase } from '../lib/useRoundReveal';
import type { Identity } from '../lib/seatProfile';
import { PLAYER_VOICE, ranOutOfTime, takesRound, type Voice } from '../lib/voice';
import {
  MOVE_META,
  describeOutcome,
  describeRoundMatchup,
  opponentMoveFromResult,
} from '../moves';
import { PlayerAvatar } from './PlayerAvatar';
import MoveIcon from './MoveIcon';

/**
 * The showdown. Takes over the pentagon's centre slot for a beat when a round
 * resolves: both picks, what beat what, and who took the round. Avatars stand
 * in for the words "You" and "Opponent".
 *
 * The slot it lands in is already the board's live region, so the card brings
 * no `role="status"` of its own: it used to, and the round result was then
 * announced by a region that had only just been mounted — the case screen
 * readers are least reliable about (JQ-157).
 */
export function RevealCard({
  result,
  phase,
  mySeatKey,
  myPlayerId,
  you,
  opponent,
  voice = PLAYER_VOICE,
  call,
  onSkip,
}: {
  result: RoundResult;
  /** 'outro' dissolves the card onto the winning arrow underneath. */
  phase: RevealPhase;
  mySeatKey: string;
  myPlayerId: string;
  you: Identity;
  opponent: Identity;
  /** How to refer to the you-side: second person, or by name on a replay. */
  voice?: Voice;
  /**
   * What the watcher called for the you-side this round, in play-along:
   * a move, `null` if they let the round go by, absent if they are watching.
   */
  call?: Move | null;
  onSkip: () => void;
}) {
  const { myMove, oppMove } = opponentMoveFromResult(result.moves, myPlayerId);
  const verdict = describeOutcome(result.outcome, mySeatKey);
  // An expired round is never silent. Whoever ran out of time is told plainly
  // that the server picked for them, and so is the player who waited.
  const autoPicked = result.autoPicked ?? [];
  const timedOut = autoPicked.includes(myPlayerId)
    ? ranOutOfTime(voice)
    : autoPicked.length > 0
      ? `${opponent.name} ran out of time — a move was picked for them`
      : null;
  const verdictLine =
    verdict === 'draw'
      ? 'Draw'
      : verdict === 'win'
        ? takesRound(voice, result.round)
        : `${opponent.name} takes round ${result.round}`;

  return (
    <div
      className={[
        'picker-center',
        'picker-center--reveal',
        'reveal-card',
        `reveal-card--${verdict}`,
        phase === 'outro' ? 'reveal-card--exiting' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="reveal-card__picks">
        <span className="reveal-card__side reveal-card__side--you">
          <PlayerAvatar
            profile={you.profile}
            displayName={you.name}
            placeholder={you.placeholder}
            role="you"
            size="sm"
          />
        </span>
        {myMove && (
          <MoveIcon move={myMove} className="reveal-card__move reveal-card__move--you" />
        )}
        <span className="reveal-card__impact" aria-hidden="true" />
        {oppMove && (
          <MoveIcon move={oppMove} className="reveal-card__move reveal-card__move--opp" />
        )}
        <span className="reveal-card__side reveal-card__side--opp">
          <PlayerAvatar
            profile={opponent.profile}
            displayName={opponent.name}
            placeholder={opponent.placeholder}
            role="opp"
            size="sm"
          />
        </span>
      </div>
      {myMove && oppMove && (
        <p className="reveal-card__verb">{describeRoundMatchup(myMove, oppMove)}</p>
      )}
      {/* The call before the verdict: the watcher's own round is the one they
          came for, and it is answered by the same card that answers the
          players'. A skipped round says nothing — they chose not to play it. */}
      {call && myMove && (
        <p className={`reveal-card__call reveal-card__call--${call === myMove ? 'hit' : 'miss'}`}>
          {call === myMove
            ? 'You called it.'
            : `You said ${MOVE_META[call].label} \u2014 ${you.name} played ${MOVE_META[myMove].label}.`}
        </p>
      )}
      <p className="reveal-card__verdict">{verdictLine}</p>
      {timedOut && <p className="reveal-card__timeout">{timedOut}</p>}
      <button className="reveal-card__skip" onClick={onSkip} aria-label="Skip to the next round" />
    </div>
  );
}
