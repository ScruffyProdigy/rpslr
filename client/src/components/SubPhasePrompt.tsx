import type { Entitlement, IncomingFiring, MidRoundReveal } from '@game/types';
import { getHelper } from '@game/helpers/roster';
import type { Move } from '../api';
import { MOVE_META } from '../moves';
import MoveIcon from './MoveIcon';

/**
 * The mid-round sub-phase, for a seat entitled to it.
 *
 * The class of thing that opens this window is *information that reached you
 * after your commitment and before the round resolved* — the one gap in a round
 * that otherwise has none. There are two ways in, and this renders both: an
 * ability told its own holder something (Oracle), or a public firing acted
 * against you. It was Oracle's alone until JQ-239 generalised it, which is why
 * this reads `entitlement.reveals` as a list rather than one card's reveal.
 *
 * The protocol needs nothing new. A re-pick is an ordinary `move`, which
 * `submitMove` routes to `replaceMove`; re-sending the move you already had is
 * how you say "keep it"; and letting the clock run out keeps it too, at no
 * strike, because everyone did pick on time.
 */
export function SubPhasePrompt({
  entitlement,
  round,
  myMove,
  onKeep,
}: {
  /** This seat's claim on the window, or null when it has none. */
  entitlement: Entitlement | null;
  /** The round on the board, which the entitlement has to agree with. */
  round: number;
  /** The pick this seat already made, which the window is offering to replace. */
  myMove: Move | null;
  onKeep: (move: Move) => void;
}) {
  // A claim that outlived its sub-phase names a round nobody is playing, so the
  // round guard is not belt-and-braces — it is why `Entitlement` carries a round.
  if (!entitlement || entitlement.round !== round) return null;

  return (
    <section className="subphase-prompt" role="status" aria-label="Your window">
      <h3 className="subphase-prompt__title">Something changed</h3>
      {entitlement.reveals.map((reveal) => (
        <RevealLine key={reveal.helperId} reveal={reveal} />
      ))}
      {entitlement.incoming.map((firing, i) => (
        <IncomingLine key={`${firing.helperId}-${i}`} firing={firing} />
      ))}
      {entitlement.acted ? (
        // Acting is written down server-side rather than inferred, because a seat
        // that re-picked the move it already had is indistinguishable from one that
        // has not answered. The board says the same thing back.
        <p className="subphase-prompt__ask">
          Your answer is in — waiting for the round to resolve.
        </p>
      ) : (
        <>
          <p className="subphase-prompt__ask">
            Pick again, or keep what you have. If the clock runs out, your pick stands.
          </p>
          {myMove && (
            <button type="button" className="subphase-prompt__keep" onClick={() => onKeep(myMove)}>
              Keep {MOVE_META[myMove].label}
            </button>
          )}
        </>
      )}
    </section>
  );
}

/** What one of your own abilities told you. */
function RevealLine({ reveal }: { reveal: MidRoundReveal }) {
  const name = getHelper(reveal.helperId)?.name ?? reveal.helperId;
  if (!reveal.namedMove) {
    // Null when there was nothing to name — for Oracle, the opponent played their
    // only live move. The charge was spent to be told that, so it is still said.
    return (
      <p className="subphase-prompt__reveal">
        <strong>{name}</strong> — they played their only live move, so there is
        nothing they did not play.
      </p>
    );
  }
  return (
    <p className="subphase-prompt__reveal">
      <strong>{name}</strong> — they did not play{' '}
      <span className="subphase-prompt__move">
        <MoveIcon move={reveal.namedMove} />
        <strong>{MOVE_META[reveal.namedMove].label}</strong>
      </span>
    </p>
  );
}

/**
 * A public firing aimed at you.
 *
 * Deliberately silent on whether it landed: that turns on the move you committed,
 * and a seat told "it missed" would learn something about their own board the
 * firer never paid for.
 */
function IncomingLine({ firing }: { firing: IncomingFiring }) {
  const name = getHelper(firing.helperId)?.name ?? firing.helperId;
  return (
    <p className="subphase-prompt__reveal">
      <strong>{name}</strong> — they fired it at you
      {firing.target ? (
        <>
          {', naming '}
          <span className="subphase-prompt__move">
            <MoveIcon move={firing.target} />
            <strong>{MOVE_META[firing.target].label}</strong>
          </span>
        </>
      ) : (
        ''
      )}
    </p>
  );
}
