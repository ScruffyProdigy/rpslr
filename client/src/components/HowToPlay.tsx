import { useModalDialog } from '../lib/useModalDialog';
import { roundCap, winsNeeded } from '../moves';
import { HowToPlayGraph } from './HowToPlayGraph';
import UiIcon from './UiIcon';

/**
 * The rules, in three panels. Mounted bare while the match waits for the
 * opponent — the one stretch of dead time a player has, and until now the one
 * the game spent saying nothing — and inside a dialog from the header's `?`
 * for the rest of the match.
 */
export function HowToPlay({ bestOf }: { bestOf: number }) {
  const needed = winsNeeded(bestOf);
  const cap = roundCap(bestOf);
  return (
    <div className="htp">
      <section className="htp-panel">
        <h3 className="htp-panel__title">What beats what</h3>
        <HowToPlayGraph />
      </section>

      <section className="htp-panel">
        <h3 className="htp-panel__title">Cooldowns</h3>
        <p className="htp-panel__lead">
          <span className="cooldown-pill">
            <UiIcon name="hourglass" /> 2
          </span>
        </p>
        <p className="htp-panel__body">
          Play a move and it rests for two rounds — you can't throw the same thing twice in a row.
          Lizard and Robot start the match on cooldown.
        </p>
        <p className="htp-panel__body htp-panel__body--aside">
          The board shows the opponent's cooldowns too: an attack they can't make this round is
          drawn as a faded arrow.
        </p>
      </section>

      <section className="htp-panel">
        <h3 className="htp-panel__title">First to {needed}</h3>
        <p className="htp-panel__lead">
          <span className="win-pips" aria-hidden="true">
            {Array.from({ length: needed }, (_, i) => (
              <span key={i} className={`win-pip ${i < needed - 1 ? 'filled' : 'empty'}`} />
            ))}
          </span>
        </p>
        <p className="htp-panel__body">
          Win {needed} rounds and the match is yours. A drawn round scores for neither of you and
          the match plays on — up to {cap} rounds, after which whoever is ahead takes it.
        </p>
      </section>
    </div>
  );
}

/**
 * The rules panels, over the board.
 *
 * Focus handling, Escape and the Tab trap are `useModalDialog`'s — shared with
 * the loadout reveal, which is the board's other modal (JQ-149).
 */
export function HowToPlayDialog({
  bestOf,
  open,
  onClose,
}: {
  bestOf: number;
  open: boolean;
  onClose: () => void;
}) {
  const { panelRef, autoFocusRef } = useModalDialog(open, onClose);

  if (!open) return null;

  return (
    <div
      className="htp-dialog"
      onClick={(e) => {
        // The backdrop is this element; the panel is a child of it.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="htp-dialog__inner"
        role="dialog"
        aria-modal="true"
        aria-label="How to play"
      >
        <div className="htp-dialog__head">
          <h2 className="htp-dialog__title">How to play</h2>
          <button ref={autoFocusRef} type="button" className="htp-dialog__close" onClick={onClose}>
            Close
          </button>
        </div>
        <HowToPlay bestOf={bestOf} />
      </div>
    </div>
  );
}
