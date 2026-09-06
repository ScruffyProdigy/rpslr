import type { RoundResult } from '../api';
import type { RevealPhase } from '../lib/useRoundReveal';
import type { Identity } from '../lib/seatProfile';
import { MOVE_META, describeOutcome, describeRoundMatchup, opponentMoveFromResult } from '../moves';
import { PlayerAvatar } from './PlayerAvatar';

/**
 * The showdown. Takes over the pentagon's centre slot for a beat when a round
 * resolves: both picks, what beat what, and who took the round. Avatars stand
 * in for the words "You" and "Opponent".
 */
export function RevealCard({
  result,
  phase,
  mySeatKey,
  myPlayerId,
  you,
  opponent,
  onSkip,
}: {
  result: RoundResult;
  /** 'outro' dissolves the card onto the winning arrow underneath. */
  phase: RevealPhase;
  mySeatKey: string;
  myPlayerId: string;
  you: Identity;
  opponent: Identity;
  onSkip: () => void;
}) {
  const { myMove, oppMove } = opponentMoveFromResult(result.moves, myPlayerId);
  const verdict = describeOutcome(result.outcome, mySeatKey);
  const verdictLine =
    verdict === 'draw'
      ? 'Draw'
      : verdict === 'win'
        ? `You take round ${result.round}`
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
      role="status"
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
          <span className="reveal-card__move reveal-card__move--you" aria-hidden="true">
            {MOVE_META[myMove].emoji}
          </span>
        )}
        <span className="reveal-card__impact" aria-hidden="true" />
        {oppMove && (
          <span className="reveal-card__move reveal-card__move--opp" aria-hidden="true">
            {MOVE_META[oppMove].emoji}
          </span>
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
      <p className="reveal-card__verdict">{verdictLine}</p>
      <button className="reveal-card__skip" onClick={onSkip} aria-label="Skip to the next round" />
    </div>
  );
}
