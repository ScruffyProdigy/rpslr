import type { OracleReveal } from '@game/types';
import type { Move } from '../api';
import { MOVE_META } from '../moves';
import MoveIcon from './MoveIcon';

/**
 * Oracle's mid-round sub-phase, for the seat that paid for it.
 *
 * The protocol needs nothing new here. A re-pick is an ordinary `move`, which
 * `submitMove` routes to `replaceMove` and resolves on; re-sending the move you
 * already had is how you say "keep it"; and letting the clock run out keeps it
 * too, at no strike, because both players did pick on time.
 *
 * The named move is one the opponent did *not* play — never the one they did,
 * which is what keeps commit-then-reveal intact. It is drawn once, server-side,
 * and written down, so reconnecting into the sub-phase shows the same move rather
 * than a second draw.
 */
export function OraclePrompt({
  reveal,
  round,
  myMove,
  onKeep,
}: {
  /** The reveal for this seat, or null when no sub-phase is running for it. */
  reveal: OracleReveal | null;
  /** The round on the board, which the reveal has to agree with. */
  round: number;
  /** The pick this seat already made, which the sub-phase is offering to replace. */
  myMove: Move | null;
  onKeep: (move: Move) => void;
}) {
  // A reveal that outlived its sub-phase names a move about a round nobody is
  // playing, so the round guard is not belt-and-braces — it is the whole reason
  // `OracleReveal` carries a round at all.
  if (!reveal || reveal.round !== round) return null;

  return (
    <section className="oracle-prompt" role="status" aria-label="Oracle">
      <h3 className="oracle-prompt__title">Oracle</h3>
      {reveal.namedMove ? (
        <p className="oracle-prompt__reveal">
          <span>They did not play</span>{' '}
          <span className="oracle-prompt__move">
            <MoveIcon move={reveal.namedMove} />
            <strong>{MOVE_META[reveal.namedMove].label}</strong>
          </span>
        </p>
      ) : (
        <p className="oracle-prompt__reveal">
          They played their only live move — there is nothing they did not play.
        </p>
      )}
      <p className="oracle-prompt__ask">
        Pick again, or keep what you have. If the clock runs out, your pick stands.
      </p>
      {myMove && (
        <button type="button" className="oracle-prompt__keep" onClick={() => onKeep(myMove)}>
          Keep {MOVE_META[myMove].label}
        </button>
      )}
    </section>
  );
}
